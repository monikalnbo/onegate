import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

const MICRO=1_000_000,MAX_CENTS=10_000_000,MAX_CREDIT_MICRO=100_000*MICRO;
const own=(object,key)=>Object.hasOwn(object,key);
const problem=(status,code,message)=>Object.assign(new Error(message),{status,code});
const invalid=message=>problem(400,'payment_invalid_input',message);
const units=value=>Number((value/MICRO).toFixed(6));
const decimal=(value,places,label)=>{
  if(!['string','number'].includes(typeof value))throw invalid(`${label}格式不正确`);
  const text=String(value);
  if(!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${places}})?$`).test(text))throw invalid(`${label}需要使用最多 ${places} 位小数的十进制数`);
  const [whole,fraction='']=text.split('.'),scaled=BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
  if(scaled>BigInt(Number.MAX_SAFE_INTEGER))throw invalid(`${label}超出范围`);
  return Number(scaled);
};
const money=cents=>`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
const safeEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
function md5(params,key){return createHash('md5').update(Object.keys(params).filter(name=>name!=='sign'&&name!=='sign_type'&&params[name]!==''&&params[name]!=null).sort().map(name=>`${name}=${params[name]}`).join('&')+key).digest('hex');}
function defaults(input={}){return{enabled:input.enabled===true,gateway_url:input.gateway_url||'',merchant_id:input.merchant_id||'',merchant_key_enc:input.merchant_key_enc||'',methods:Array.isArray(input.methods)?input.methods:['alipay','wxpay'],min_cents:input.min_cents??100,max_cents:input.max_cents??100000,credit_rate_10000:input.credit_rate_10000??null};}
function validate(config,complete=false){
  if(config.gateway_url){let url;try{url=new URL(config.gateway_url);}catch{throw invalid('请填写有效支付网关 HTTPS 地址');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.hostname==='localhost'||url.hostname.endsWith('.localhost'))throw invalid('支付网关需要完整 HTTPS 地址，且不带查询参数和凭据');if(!url.pathname.endsWith('/'))url.pathname+='/';config.gateway_url=url.href;}
  if(config.merchant_id&&!/^\d{1,32}$/.test(config.merchant_id))throw invalid('商户编号需要为 1 至 32 位数字');
  if(!Array.isArray(config.methods)||!config.methods.length||config.methods.length>2||config.methods.some(value=>!['alipay','wxpay'].includes(value))||new Set(config.methods).size!==config.methods.length)throw invalid('支付方式仅支持支付宝和微信支付');
  if(!Number.isSafeInteger(config.min_cents)||!Number.isSafeInteger(config.max_cents)||config.min_cents<1||config.max_cents<config.min_cents||config.max_cents>MAX_CENTS)throw invalid('支付金额范围需要在 0.01 至 100000.00 元之间');
  if(config.credit_rate_10000!==null&&(!Number.isSafeInteger(config.credit_rate_10000)||config.credit_rate_10000<1||config.credit_rate_10000>1_000_000_000||config.max_cents*config.credit_rate_10000>MAX_CREDIT_MICRO))throw invalid('额度换算需要为正数，且单笔额度不超过 100000');
  if((complete||config.enabled)&&(!config.gateway_url||!config.merchant_id||!config.merchant_key_enc||config.credit_rate_10000===null))throw invalid('启用支付前请补齐网关、商户编号、密钥与换算比例');
  return config;
}

/** Uses the Portal's one durable mutation queue and ledger; no network checkout call. */
export function createPayments({store,serial,requireUser,guardWrite,limit,ledgerAdd,sendJson,pageOf,origin,now=()=>Date.now(),adminAuthorized,accountActive}={}){
  const payment=()=>store.data.portal.payment;
  if(!payment()||typeof payment()!=='object')store.data.portal.payment={config:defaults()};
  payment().config=defaults(payment().config);store.data.portal.orders||=[];
  const orders=()=>store.data.portal.orders;
  const clock=()=>new Date(now()).toISOString();
  const basePath=String(process.env.PUBLIC_BASE_PATH||'').replace(/\/+$/,'');
  const notifyUrl=`${origin}${basePath}/portal/payment/notify`,returnUrl=`${origin}/#/account/wallet`;
  function credential(config){try{const key=store.decrypt(config.merchant_key_enc);if(typeof key!=='string'||key.length<6||key.length>512||/[\u0000-\u0020\u007f]/.test(key))throw Error();return key;}catch{throw problem(503,'payment_unavailable','支付配置暂未就绪');}}
  function ready(config=payment().config){try{return config.enabled===true&&!!validate({...config},true)&&!!credential(config);}catch{return false;}}
  function meta(){const c=payment().config;return{enabled:c.enabled===true,ready:ready(c),methods:[...c.methods],min_amount_cny:Number(money(c.min_cents)),max_amount_cny:Number(money(c.max_cents)),credits_per_cny:c.credit_rate_10000===null?null:c.credit_rate_10000/10000,currency:'CNY'};}
  function configView(){const c=payment().config;return{...meta(),gateway_url:c.gateway_url,merchant_id:c.merchant_id,merchant_key_configured:!!c.merchant_key_enc,notify_url:notifyUrl,return_url:returnUrl};}
  const orderView=order=>({id:order.id,order_no:order.order_no,status:order.status,amount_cny:money(order.amount_cents),amount_cents:order.amount_cents,credits:units(order.credits_micro),pay_type:order.pay_type,currency:'CNY',created_at:order.created_at,paid_at:order.paid_at||null,expires_at:null,...(order.status==='pending'?{checkout_url:checkout(order)}:{})});
  function checkout(order){const values={pid:order.merchant_id,type:order.pay_type,out_trade_no:order.order_no,notify_url:order.notify_url,return_url:order.return_url,name:'OneGate 账户充值',money:money(order.amount_cents)};values.sign=md5(values,credential(order));values.sign_type='MD5';const url=new URL('submit.php',order.gateway_url);url.search=new URLSearchParams(values).toString();return url.href;}
  async function saveConfig(body){
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(name=>!['enabled','gateway_url','merchant_id','merchant_key','methods','min_amount_cny','max_amount_cny','credits_per_cny'].includes(name)))throw invalid('支付配置包含无效字段');
    return serial(()=>{
      const next=structuredClone(payment().config);
      if(own(body,'enabled')){if(typeof body.enabled!=='boolean')throw invalid('支付启用状态需要为布尔值');next.enabled=body.enabled;}
      for(const name of ['gateway_url','merchant_id'])if(own(body,name)){if(typeof body[name]!=='string'||body[name].length>2048||body[name]!==body[name].trim())throw invalid('网关或商户编号格式不正确');next[name]=body[name];}
      if(own(body,'methods'))next.methods=body.methods;
      if(own(body,'min_amount_cny'))next.min_cents=decimal(body.min_amount_cny,2,'最小金额');
      if(own(body,'max_amount_cny'))next.max_cents=decimal(body.max_amount_cny,2,'最大金额');
      if(own(body,'credits_per_cny'))next.credit_rate_10000=decimal(body.credits_per_cny,4,'每元额度');
      if(own(body,'merchant_key')){
        const key=body.merchant_key;if(typeof key!=='string'||key.length>512||/[\u0000-\u0020\u007f]/.test(key))throw invalid('商户密钥格式不正确');
        if(key){if(key.length<6)throw invalid('商户密钥至少需要 6 个字符');try{next.merchant_key_enc=store.encrypt(key);if(next.merchant_key_enc===key||store.decrypt(next.merchant_key_enc)!==key)throw Error();}catch{throw problem(503,'payment_encryption_failed','商户密钥加密保存失败');}}
      }
      validate(next);if(next.enabled)credential(next);payment().config=next;return configView();
    });
  }
  async function paramsOf(req){
    const all=new URLSearchParams(new URL(req.url,origin).searchParams);
    if(req.method==='POST'){
      if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/x-www-form-urlencoded'))throw problem(400,'payment_notify_invalid','通知需要表单编码');
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw problem(413,'payment_notify_invalid','支付通知过长');chunks.push(chunk);}for(const [key,value]of new URLSearchParams(Buffer.concat(chunks).toString()))all.append(key,value);
    }
    if([...all].length>32)throw invalid('支付通知字段过多');
    const params={};for(const [name,value]of all){if(own(params,name)||!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name)||value.length>2048||/[\u0000-\u001f\u007f]/.test(value))throw invalid('支付通知格式不正确');params[name]=value;}return params;
  }
  async function notify(req,res){
    try{
      if(!['GET','POST'].includes(req.method))throw problem(405,'payment_notify_invalid','支付通知方法不正确');
      const params=await paramsOf(req);
      await serial(()=>{
        const order=orders().find(item=>item.order_no===params.out_trade_no);if(!order)throw invalid('未找到支付订单');
        if(params.sign_type!=='MD5'||!/^[a-fA-F0-9]{32}$/.test(params.sign||'')||!safeEqual(md5(params,credential(order)),params.sign.toLowerCase()))throw invalid('支付签名校验失败');
        if(params.pid!==order.merchant_id||params.trade_status!=='TRADE_SUCCESS'||params.type!==order.pay_type||!/^[a-zA-Z0-9_-]{1,128}$/.test(params.trade_no||'')||decimal(params.money,2,'支付金额')!==order.amount_cents||params.currency&&params.currency!=='CNY')throw invalid('支付通知与订单不匹配');
        if(orders().some(item=>item.id!==order.id&&item.merchant_id===order.merchant_id&&item.trade_no===params.trade_no))throw invalid('此交易已用于另一订单');
        if(order.status==='paid'){if(order.trade_no!==params.trade_no)throw invalid('订单交易编号不匹配');return;}
        if(order.status!=='pending')throw invalid('订单已关闭');
        const user=store.data.portal.users.find(item=>item.id===order.user_id);if(!accountActive(user))throw invalid('订单账户状态不正确');
        const reference=`payment:${order.order_no}`,existing=store.data.portal.ledger.find(row=>row.user_id===user.id&&row.reference===reference);
        if(!existing){const balance=Number(user.balance_micro||0);if(!Number.isSafeInteger(balance)||balance<0||!Number.isSafeInteger(order.credits_micro)||order.credits_micro<1||order.credits_micro>MAX_CREDIT_MICRO||!Number.isSafeInteger(balance+order.credits_micro))throw problem(503,'payment_balance_invalid','账户额度状态不正确');user.balance_micro=balance+order.credits_micro;ledgerAdd(user,'payment',order.credits_micro,`在线充值 ¥${money(order.amount_cents)}`,reference);}
        order.status='paid';order.trade_no=params.trade_no;order.paid_at=clock();
      });
      res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('success');
    }catch(error){res.writeHead(error.status||503,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('fail');}
    return true;
  }
  async function handle(req,res,path,parse){
    if(path==='/portal/payment/notify')return notify(req,res);
    if(!['/portal/paymentmeta','/portal/orders'].includes(path))return false;
    guardWrite(req);
    if(req.method==='GET'&&path==='/portal/paymentmeta'){sendJson(res,200,meta());return true;}
    requireUser(req);
    if(req.method==='GET'&&path==='/portal/orders'){const {user}=requireUser(req);sendJson(res,200,pageOf(req,orders().filter(row=>row.user_id===user.id).toReversed().map(orderView)));return true;}
    if(req.method==='POST'&&path==='/portal/orders'){
      const body=await parse(req);
      const result=await serial(()=>{
        const {user}=requireUser(req),config=payment().config;
        const cents=decimal(body.amount_cny,2,'充值金额');
        let reference=null;if(body.reference!==undefined){if(typeof body.reference!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.reference))throw invalid('订单重试编号格式不正确');reference=body.reference;}
        const existing=reference&&orders().find(order=>order.user_id===user.id&&order.reference===reference);
        if(existing){if(existing.amount_cents!==cents||existing.pay_type!==body.pay_type)throw problem(409,'payment_reference_conflict','相同订单编号的金额或支付方式已改变，请重新创建订单');return{status:200,body:{order:orderView(existing),...(existing.status==='pending'?{checkout_url:checkout(existing)}:{})}};}
        if(!ready(config))throw problem(503,'payment_unavailable','在线支付尚未开通，请等待商户配置完成');
        if(cents<config.min_cents||cents>config.max_cents)throw invalid('充值金额超出允许范围');
        if(!config.methods.includes(body.pay_type))throw invalid('请选择已开通的支付方式');limit(`payment-orders:${user.id}`,10,600_000);
        const order={id:randomUUID(),order_no:'CL'+now().toString(36).toUpperCase()+randomBytes(12).toString('hex').toUpperCase(),user_id:user.id,reference,status:'pending',amount_cents:cents,credits_micro:cents*config.credit_rate_10000,pay_type:body.pay_type,created_at:clock(),paid_at:null,merchant_id:config.merchant_id,merchant_key_enc:config.merchant_key_enc,gateway_url:config.gateway_url,notify_url:notifyUrl,return_url:returnUrl};
        const url=checkout(order);orders().push(order);return{status:201,body:{order:orderView(order),checkout_url:url}};
      });sendJson(res,result.status,result.body);return true;
    }
    throw problem(405,'method_not_allowed','账户支付接口方法不正确');
  }
  async function handleAdmin(req,res,path,parse){
    if(path!=='/admin/api/payment')return false;
    if(!adminAuthorized(req))throw problem(403,'admin_required','需要管理员身份');guardWrite(req);
    if(req.method==='GET'){sendJson(res,200,configView());return true;}
    if(req.method==='PUT'){const body=await parse(req);const result=await saveConfig(body);sendJson(res,200,result);return true;}
    throw problem(405,'method_not_allowed','支付配置接口方法不正确');
  }
  return{handle,handleAdmin,meta};
}
