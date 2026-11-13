import { randomBytes, randomInt, randomUUID, createHash, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import bcrypt from 'bcryptjs';
import { createPayments } from './payments.mjs';

const scrypt = promisify(scryptCallback);
// note: bcrypt cost, >=10 required; 12 chosen for a ~250-500ms hash on the production CPU.
const BCRYPT_COST = 12;
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const MICRO = 1_000_000;
// note: verification-code lifetime, 10 minutes by default (overridable for expiry drills only).
const CODE_TTL_MS = Number(process.env.PORTAL_CODE_TTL_SECONDS) > 0 ? Math.floor(Number(process.env.PORTAL_CODE_TTL_SECONDS) * 1000) : 600_000;
const units = micros => Number((Number(micros || 0) / MICRO).toFixed(6));
const micro = amount => Math.round(Number(amount) * MICRO);
const safeEqual = (a,b) => { const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y); };
const problem = (status,code,message) => Object.assign(new Error(message),{status,code});
const validScryptHash=value=>/^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(String(value||''));
// note: bcrypt is the preferred store; legacy scrypt hashes stay verifiable so old accounts keep working.
const validBcryptHash=value=>/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value||''));
const validPasswordHash=value=>validBcryptHash(value)||validScryptHash(value);
const accountActive=user=>!!user&&(user.verified===true||user.active===true&&user.credential_ready===true&&validPasswordHash(user.password_hash));
// note: group membership is part of the account view so the admin UI can show and change it.
const userView = user => ({id:user.id,email:user.email,verified:user.verified===true,email_verified:user.verified===true,active:accountActive(user),credential_ready:validPasswordHash(user.password_hash),created_at:user.created_at,disabled:user.disabled===true,group_id:user.group_id||null,last_active_at:user.last_active_at||null});
const keyView = key => ({id:key.id,name:key.name,suffix:key.suffix||'',enabled:key.enabled!==false,rpm:key.rpm,budget:units(key.budget_micro||0),used:units(key.portal_used_micro||0),quota_usd:Number(key.quota_usd||0),used_usd:Number(key.used_usd||0),group_id:key.group_id||null,created_at:key.created_at,last_used_at:key.last_used_at||null,revoked_at:key.revoked_at||null});
const transactions = new AsyncLocalStorage();
const sendJson = (res,status,body,headers={}) => {const send=()=>{const data=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':Buffer.byteLength(data),...headers});res.end(data);};const transaction=transactions.getStore();if(transaction)transaction.push(send);else send();};
const cleanEmail = value => { const email=String(value||'').trim().toLowerCase();if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw problem(400,'invalid_email','请填写有效邮箱地址');return email; };
const requirePassword = value => { const password=String(value||'');if(password.length<8||password.length>128)throw problem(400,'invalid_password','密码需要 8 至 128 个字符');return password; };
// note: every new password is bcrypt ($2b$, per-hash random salt) — plaintext is never stored or logged.
async function passwordHash(value) { return bcrypt.hash(String(value),BCRYPT_COST); }
async function passwordMatches(value,stored) {
  try{
    if(String(value||'').length>128)return false;
    if(validBcryptHash(stored))return await bcrypt.compare(String(value),String(stored));
    if(validScryptHash(stored)){const [kind,n,r,p,salt,digest]=String(stored).split('$');const derived=await scrypt(String(value),salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return safeEqual(derived.toString('hex'),digest);}
    return false;
  }catch{return false;}
}
const passwordNeedsUpgrade=stored=>!/^\$2b\$\d{2}\$/.test(String(stored||''));
const bcryptCost=stored=>{const m=/^\$2[aby]\$(\d{2})\$/.exec(String(stored||''));return m?Number(m[1]):0;};

/** All mutations go through one queue. Existing legacy keys are never adopted. */
export function createPortal({store,sendMail,mailReady=()=>false,origin='https://example.com',origins=[],pricing={table:{}},now=()=>Date.now(),cookieSecure=true,adminAuthorized=req=>req.portalAdminAuthorized===true}={}) {
  if(!store?.data||typeof store.save!=='function')throw new TypeError('Portal requires the existing Relay store');
  const initial={users:[],sessions:[],verification:[],ledger:[],requests:[],reservations:[],rate:[],orders:[],settings:{registration_enabled:true}};
  store.data.portal={...initial,...store.data.portal};
  for(const key of ['users','sessions','verification','ledger','requests','reservations','rate','orders'])if(!Array.isArray(store.data.portal[key]))store.data.portal[key]=[];
  store.data.portal.settings={registration_enabled:true,registration_mode:'email_code',billing_currency:null,credit_unit_cny:null,...store.data.portal.settings};
  store.data.keys ||= [];store.data.redeem ||= [];
  let queue=Promise.resolve();
  // In-flight delivery is not a usable verification challenge and is never persisted.
  const pendingMail=new Map();
  const pendingDirect=new Map();
  // Previous process reservations have no running upstream request after a restart.
  store.data.portal.reservations=[];
  const data=()=>store.data.portal;
  const clock=()=>new Date(now()).toISOString();
  const serial=fn=>{const next=queue.then(async()=>{const snapshots={portal:structuredClone(data()),keys:structuredClone(store.data.keys),redeem:structuredClone(store.data.redeem)};const replies=[];let value,error;await transactions.run(replies,async()=>{try{value=await fn();}catch(caught){error=caught;}});try{await store.save();}catch{store.data.portal=snapshots.portal;store.data.keys=snapshots.keys;store.data.redeem=snapshots.redeem;throw problem(503,'storage_unavailable','账户数据暂时无法保存，请稍后重试');}if(error)throw error;replies.forEach(send=>send());return value;});queue=next.catch(()=>{});return next;};
  // Secure cookies by default; set COOKIE_SECURE=false only for plain-HTTP local experiments.
  const cookieFlags = cookieSecure ? 'HttpOnly; Secure; SameSite=Lax' : 'HttpOnly; SameSite=Lax';
  const sessionCookie = sid => `portal_session=${sid}; ${cookieFlags}; Path=/; Max-Age=604800`;
  const clearedCookie=`portal_session=; ${cookieFlags}; Path=/; Max-Age=0`;
  const sessionToken=req=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('portal_session='))?.slice(15)||'';
  const sessionFor=req=>{const token=sessionToken(req);return token?data().sessions.find(session=>session.hash===hash(token)&&session.expires_at>now()):null;};
  const requireUser=req=>{const session=sessionFor(req),user=session&&data().users.find(user=>user.id===session.user_id);if(!accountActive(user)||user.disabled)throw problem(401,'authentication_required','请先登录已激活的账户');return{user,session};};
  const sessionNew=user=>{const sid=randomBytes(32).toString('base64url');data().sessions=data().sessions.filter(session=>session.expires_at>now());data().sessions.push({hash:hash(sid),user_id:user.id,created_at:clock(),expires_at:now()+7*86400_000});return sid;};
  const balance=user=>Math.max(0,Number(user.balance_micro||0));
  const held=(userId,keyId=null)=>data().reservations.filter(r=>r.user_id===userId&&(!keyId||r.key_id===keyId)).reduce((sum,r)=>sum+Number(r.amount_micro||0),0);
  const ledgerAdd=(user,type,amount,note,reference)=>{const existing=reference&&data().ledger.find(item=>item.reference===reference&&item.user_id===user.id);if(existing)return existing;const row={id:randomUUID(),user_id:user.id,created_at:clock(),type,amount:units(amount),balance:units(balance(user)),note:String(note||'').slice(0,500),reference:reference||null};data().ledger.push(row);return row;};
  const ratesFor=model=>{const rates=Object.hasOwn(pricing.table||{},model)?pricing.table[model]:null;return rates&&['in','out','cache'].every(k=>Number.isFinite(Number(rates[k]))&&Number(rates[k])>=0)?{in:Number(rates.in),out:Number(rates.out),cache:Number(rates.cache)}:null;};
  // note: user groups are plain records in store.data.groups ({kind:'user'}) shared with the
  // existing key groups ({kind:'key'}); `rate_multiplier` is the only billing knob and defaults to 1.
  const groupFor=id=>id?(store.data.groups||[]).find(group=>group.id===id)||null:null;
  const rateMultiplier=group=>Math.min(100,Math.max(0.1,Number(group?.rate_multiplier)||1));
  const keyHint=key=>key?.suffix?`sk-…${key.suffix}`:(key?.key_hash?`sha256:${String(key.key_hash).slice(0,8)}…`:'');
  const requestIp=req=>req.portalClientIp||req.socket?.remoteAddress||'';
  const summarize=user=>({...userView(user),balance:units(balance(user)),spent:units(user.spent_micro),keys_count:store.data.keys.filter(key=>key.user_id===user.id&&!key.revoked_at).length,requests_count:data().requests.filter(row=>row.user_id===user.id).length,group_name:groupFor(user.group_id)?.name||null});
  const billingReady=()=>Object.keys(pricing.table||{}).some(model=>ratesFor(model));
  const billingMetadata=()=>data().settings.billing_currency==='CNY'&&data().settings.credit_unit_cny===1?{currency:'CNY',credits_per_cny:1}:{currency:null,credits_per_cny:null};
  const registrationMode=()=>data().settings.registration_mode==='email_password'?'email_password':'email_code';
  const registrationMetadata=async()=>({registration_mode:registrationMode(),email_verification_required:registrationMode()!=='email_password',registration_enabled:data().settings.registration_enabled!==false&&(registrationMode()==='email_password'||await ready())});
  async function ready(){try{const result=await mailReady();return typeof result==='object'?result?.ready===true:result===true;}catch{return false;}}
  const allowedOrigins=new Set([origin,...origins].filter(Boolean));
  function guardWrite(req){if(!['GET','HEAD'].includes(req.method)&&!allowedOrigins.has(req.headers.origin))throw problem(403,'origin_not_allowed','请求来源校验失败');}
  function limit(key,max,windowMs){const cutoff=now()-windowMs;data().rate=data().rate.filter(row=>row.ts>now()-24*3600_000);const entries=data().rate.filter(row=>row.key===key&&row.ts>cutoff);if(entries.length>=max)throw problem(429,'rate_limited','请求过于频繁，请稍后重试');data().rate.push({key,ts:now()});}
  function ip(req){return req.portalClientIp||req.socket?.remoteAddress||'unknown';}
  function ownKey(user,id){const key=store.data.keys.find(key=>key.id===id&&key.user_id===user.id&&!key.revoked_at);if(!key)throw problem(404,'key_not_found','未找到该密钥');return key;}
  function pageOf(req,items){const url=new URL(req.url,origin),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||20)),offset=Math.max(0,Number(url.searchParams.get('offset'))||0);return{items:items.slice(offset,offset+limit),total:items.length,limit,offset};}
  const payments=createPayments({store,serial,requireUser,guardWrite,limit,ledgerAdd,sendJson,pageOf,origin,now,adminAuthorized,accountActive});

  function directCandidate(email){
    const user=data().users.find(item=>item.email===email);
    if(user?.disabled)throw problem(403,'account_disabled','账户已停用，请联系管理员');
    if(accountActive(user)||user?.password_hash||data().verification.some(item=>item.user_id===user?.id)||pendingMail.has(`verify:${email}`))throw problem(409,'email_registered','这个邮箱已有账户或待完成的邮箱验证，请登录或完成原验证');
    return user;
  }
  async function registerDirect(req,res,email,password){
    const token=randomUUID();
    try{
      const shellId=await serial(()=>{
        if(registrationMode()!=='email_password'||data().settings.registration_enabled===false)throw problem(503,'registration_unavailable','邮箱注册服务暂未开放');
        limit(`register-ip:${ip(req)}`,12,3600_000);limit(`register-email:${email}`,8,3600_000);
        if(pendingDirect.has(email))throw problem(429,'registration_in_progress','这个邮箱正在注册，请稍后登录');
        const user=directCandidate(email);pendingDirect.set(email,token);return user?.id||null;
      });
      const encoded=await passwordHash(password);
      return await serial(()=>{
        if(registrationMode()!=='email_password'||data().settings.registration_enabled===false)throw problem(503,'registration_unavailable','邮箱注册服务暂未开放');
        let user=directCandidate(email);
        if(pendingDirect.get(email)!==token||(user?.id||null)!==shellId)throw problem(409,'registration_changed','账户状态已改变，请重新登录');
        if(!user){user={id:randomUUID(),email,verified:false,disabled:false,created_at:clock(),balance_micro:0,spent_micro:0};data().users.push(user);}
        user.password_hash=encoded;user.active=true;user.credential_ready=true;user.activated_at=clock();
        const sid=sessionNew(user);sendJson(res,201,{ok:true,user:userView(user),requires_verification:false},{'set-cookie':sessionCookie(sid)});return true;
      });
    }finally{if(pendingDirect.get(email)===token)pendingDirect.delete(email);}
  }

  function mailState(user,purpose){
    if(!user||user.disabled)throw problem(403,'account_unavailable','账户已停用或不可用');
    if(purpose==='verify'){
      if(user.verified)throw problem(409,'email_registered','这个邮箱已验证，请直接登录');
      if(data().settings.registration_enabled===false)throw problem(503,'registration_unavailable','邮箱注册服务暂未开放');
    }else if(!accountActive(user))throw problem(400,'verification_unavailable','账户状态已改变，请重新申请验证码');
  }
  function prepareCode(user,purpose,req,token,registration=false){
    mailState(user,purpose);
    const lockKey=`${purpose}:${user.email}`;
    if(pendingMail.has(lockKey))throw problem(429,'mail_in_progress','验证邮件正在发送，请稍后重试');
    const previous=data().verification.find(item=>item.user_id===user.id&&item.purpose===purpose);
    if(previous?.sent_at>now()-60_000)throw problem(429,'resend_too_soon','请等待 60 秒后再次发送');
    const password=previous?.pending_password_hash||user.password_hash;
    if(purpose==='verify'&&!registration&&accountActive(user))throw problem(409,'email_registered','这个邮箱已验证，请直接登录');
    if(purpose==='verify'&&!registration&&!password)throw problem(400,'verification_unavailable','上次注册未完成，请重新填写邮箱和密码注册');
    limit(`mail-ip:${ip(req)}`,12,3600_000);limit(`mail:${user.email}`,8,3600_000);
    const code=String(randomInt(0,1_000_000)).padStart(6,'0');
    // note: TTL configurable (default 600s) so expiry can be tested without touching production defaults.
    const record={id:randomUUID(),user_id:user.id,purpose,hash:hash(code),created_at:clock(),sent_at:now(),expires_at:now()+CODE_TTL_MS,attempts:0};
    if(purpose==='verify'){record.kind=accountActive(user)?'email_proof':'registration';if(record.kind==='registration'&&!registration)record.pending_password_hash=password;}
    pendingMail.set(lockKey,token);
    return{token,lockKey,user_id:user.id,email:user.email,purpose,code,record,previous_id:previous?.id||null,password_hash:user.password_hash||null};
  }
  async function issueCode(req,res,{email,purpose,registration=false,password}){
    const token=randomUUID(),lockKey=`${purpose}:${email}`;
    // note: only an account that already finished verification can receive a reset code. For
    // everything else (unknown / not yet verified / disabled) the answer is byte-identical 200 {"ok":true} and *no mail is sent*.
    try{
      const work=await serial(()=>{
        if(purpose==='reset'){
          limit(`forgot-ip:${ip(req)}`,12,3600_000);
          // note: throttled unconditionally, before the account lookup, so a known and an unknown address
          // get the same 429 on a repeat within 60s (a conditional throttle would itself leak existence).
          limit(`forgot:${email}`,1,60_000);
          const candidate=data().users.find(item=>item.email===email);
          if(!candidate||!accountActive(candidate)||candidate.disabled){sendJson(res,200,{ok:true});return null;}
        }
        if(registration)limit(`register-ip:${ip(req)}`,12,3600_000);
        let user=data().users.find(item=>item.email===email);
        if(registration&&(accountActive(user)||pendingDirect.has(email)))throw problem(409,'email_registered','这个邮箱已注册，请登录');
        if(!user&&registration){user={id:randomUUID(),email,password_hash:null,verified:false,disabled:false,created_at:clock(),balance_micro:0,spent_micro:0};data().users.push(user);}
        if(!user)throw problem(400,'verification_unavailable','请先注册或直接登录');
        return prepareCode(user,purpose,req,token,registration);
      });
      if(!work)return true;
      // Nothing was sent yet, so a delivery outage must not turn into a different status code that reveals the account exists.
      if(!await ready()){if(purpose==='reset'){sendJson(res,200,{ok:true});return true;}throw problem(503,'mail_unavailable','邮箱验证服务暂未配置完成，请稍后重试');}
      // Expensive password hashing and network transport never hold the billing queue.
      if(registration)work.record.pending_password_hash=await passwordHash(password);
      let delivery;
      try{delivery=await sendMail({to:work.email,subject:purpose==='reset'?'重置OneGate账户密码':'验证你的OneGate邮箱',purpose,text:`你的OneGate验证码是 ${work.code}，10 分钟内有效。请勿向他人透露。`,html:`<p>你的OneGate验证码是 <strong>${work.code}</strong>，10 分钟内有效。</p><p>请勿向他人透露。</p>`});}
      catch{if(purpose==='reset'){sendJson(res,200,{ok:true});return true;}throw problem(503,'mail_delivery_failed','验证邮件发送失败，请稍后重试');}
      return await serial(()=>{
        const user=data().users.find(item=>item.id===work.user_id);
        try{mailState(user,purpose);}catch(error){if(purpose==='reset'){sendJson(res,200,{ok:true});return true;}throw error;}
        const current=data().verification.find(item=>item.user_id===work.user_id&&item.purpose===purpose);
        if(pendingMail.get(lockKey)!==token||(current?.id||null)!==work.previous_id||(user.password_hash||null)!==work.password_hash)throw problem(409,'verification_changed','账户验证状态已改变，请重新申请验证码');
        work.record.sent_at=now();work.record.expires_at=now()+CODE_TTL_MS;work.record.created_at=clock();
        if(delivery?.message_id)work.record.mail_message_id=String(delivery.message_id).slice(0,200);
        data().verification=data().verification.filter(item=>!(item.user_id===work.user_id&&item.purpose===purpose));
        data().verification.push(work.record);
        sendJson(res,purpose==='reset'?200:202,purpose==='reset'?{ok:true}:{ok:true,email,requires_verification:true});
        return true;
      });
    }finally{if(pendingMail.get(lockKey)===token)pendingMail.delete(lockKey);}
  }
  // note: distinct, non-enumerative failure reasons for the registration UI.
  function verifyCode(user,purpose,code){
    const record=data().verification.find(item=>item.user_id===user.id&&item.purpose===purpose);
    // note: for reset the "no such code" and "wrong code" copy/status are identical on purpose — otherwise a
    // caller could probe any address to learn whether it has an account.
    if(!record)throw problem(400,'invalid_verification_code',purpose==='reset'?'验证码无效或已过期':'请先获取验证码，再完成注册');
    if(record.expires_at<=now()){data().verification=data().verification.filter(item=>item.id!==record.id);throw problem(400,'code_expired','验证码已过期，请重新获取');}
    // note: one code allows exactly 5 wrong guesses; the 6th attempt is rejected as too_many_attempts
    // and the code is burnt, so an attacker cannot keep guessing while a fresh code is never issued.
    if(record.attempts>=5){if(purpose==='reset')data().verification=data().verification.filter(item=>item.id!==record.id);throw problem(429,'too_many_attempts','验证码错误次数过多，请重新获取');}
    if(!/^\d{6}$/.test(String(code||'')))throw problem(400,'invalid_verification_code','验证码格式不正确');
    record.attempts++;
    if(!safeEqual(record.hash,hash(code)))throw problem(400,'invalid_verification_code',purpose==='reset'?'验证码无效或已过期':'验证码不正确，请检查后重试');
    data().verification=data().verification.filter(item=>item.id!==record.id);
    return record;
  }

  async function route(req,res,path,parse){
    if(await payments.handle(req,res,path,parse))return true;
    guardWrite(req);
    if(req.method==='GET'&&path==='/portal/meta'){sendJson(res,200,{mail_ready:await ready(),...await registrationMetadata(),billing_ready:billingReady(),...billingMetadata()});return true;}
    if(req.method==='POST'&&path==='/portal/register'){
      if(data().settings.registration_enabled===false||registrationMode()==='email_code'&&!await ready())throw problem(503,'registration_unavailable','邮箱注册服务暂未开放');
      const body=await parse(req),email=cleanEmail(body.email),password=requirePassword(body.password);
      if(registrationMode()==='email_password')return await registerDirect(req,res,email,password);
      return await issueCode(req,res,{email,password,purpose:'verify',registration:true});
    }
    if(req.method==='POST'&&path==='/portal/resend'){
      const body=await parse(req),email=cleanEmail(body.email);return await issueCode(req,res,{email,purpose:'verify'});
    }
    if(req.method==='POST'&&path==='/portal/verify'){
      const body=await parse(req),email=cleanEmail(body.email);return await serial(async()=>{limit(`verify-ip:${ip(req)}`,50,3600_000);const user=data().users.find(user=>user.email===email&&!user.verified);if(!user||user.disabled)throw problem(400,'invalid_verification_code','验证码无效或已过期');const challenge=verifyCode(user,'verify',body.code);if(!accountActive(user)){if(challenge.kind==='email_proof'||!validPasswordHash(challenge.pending_password_hash))throw problem(400,'invalid_verification_code','请重新完成账户注册');user.password_hash=challenge.pending_password_hash;user.active=true;user.credential_ready=true;user.activated_at=clock();}user.verified=true;user.verified_at=clock();const sid=sessionNew(user);sendJson(res,200,{ok:true,user:userView(user)},{'set-cookie':sessionCookie(sid)});return true;});
    }
    if(req.method==='POST'&&path==='/portal/login'){
      const body=await parse(req),email=cleanEmail(body.email);return await serial(async()=>{limit(`login-ip:${ip(req)}`,40,900_000);limit(`login-email:${email}`,15,900_000);const user=data().users.find(user=>user.email===email);const pending=user?data().verification.find(item=>item.user_id===user.id&&item.purpose==='verify')?.pending_password_hash:undefined;if(!user||!await passwordMatches(body.password,user.password_hash||pending))throw problem(401,'invalid_credentials','邮箱或密码不正确');if(accountActive(user)&&user.email===email&&passwordNeedsUpgrade(user.password_hash)){/* note: silent upgrade of legacy hashes after a proven login; failure never blocks the login. */try{user.password_hash=await passwordHash(String(body.password));}catch{}}if(!accountActive(user))throw problem(403,'email_unverified','请先完成账户邮箱验证');if(user.disabled)throw problem(403,'account_disabled','账户已停用，请联系管理员');user.last_active_at=clock();const sid=sessionNew(user);sendJson(res,200,{ok:true,user:userView(user)},{'set-cookie':sessionCookie(sid)});return true;});
    }
    if(req.method==='POST'&&path==='/portal/logout'){return await serial(async()=>{const token=sessionToken(req);data().sessions=data().sessions.filter(session=>session.hash!==hash(token));sendJson(res,200,{ok:true},{'set-cookie':clearedCookie});return true;});}
    if(req.method==='POST'&&path==='/portal/forgot'){
      // note: never reveal whether an account exists. Mail readiness is only enforced for registered+active accounts,
      // so an unknown address still gets the same 200 {"ok":true} as a known one, and nothing is sent.
      const body=await parse(req),email=cleanEmail(body.email);
      return await issueCode(req,res,{email,purpose:'reset'});
    }
    if(req.method==='POST'&&path==='/portal/reset'){
      const body=await parse(req),email=cleanEmail(body.email),password=requirePassword(body.password);
      // note: password format is validated for every address alike, and the hash is computed before the
      // account lookup (outside the mutation queue) so unknown addresses pay the same cost and show no timing signal.
      const encoded=await passwordHash(password);
      return await serial(async()=>{limit(`reset-ip:${ip(req)}`,20,3600_000);const user=data().users.find(user=>user.email===email&&accountActive(user)&&!user.disabled);if(!user)throw problem(400,'invalid_verification_code','验证码无效或已过期');verifyCode(user,'reset',body.code);user.password_hash=encoded;user.password_updated_at=clock();data().sessions=data().sessions.filter(session=>session.user_id!==user.id);sendJson(res,200,{ok:true},{'set-cookie':clearedCookie});return true;});
    }
    if(!['/portal/me','/portal/keys','/portal/usage','/portal/ledger','/portal/redeem','/portal/password'].includes(path)&&!/^\/portal\/keys\/[^/]+$/.test(path))return false;
    const {user,session}=requireUser(req);
    if(req.method==='GET'&&path==='/portal/me'){const keys=store.data.keys.filter(key=>key.user_id===user.id&&!key.revoked_at),requests=data().requests.filter(request=>request.user_id===user.id);sendJson(res,200,{user:userView(user),balance:units(balance(user)),available:units(Math.max(0,balance(user)-held(user.id))),spent:units(user.spent_micro),keys_count:keys.length,requests_count:requests.length,...billingMetadata(),readiness:{mail:await ready(),billing:billingReady()},onboarding:{has_credit:balance(user)>0,has_key:keys.length>0,has_request:requests.length>0}});return true;}
    if(req.method==='GET'&&path==='/portal/keys'){sendJson(res,200,{items:store.data.keys.filter(key=>key.user_id===user.id&&!key.revoked_at).map(keyView)});return true;}
    if(req.method==='POST'&&path==='/portal/keys'){
      const body=await parse(req);return await serial(async()=>{const {user}=requireUser(req);if(store.data.keys.filter(key=>key.user_id===user.id&&!key.revoked_at).length>=10)throw problem(400,'key_limit','最多创建 10 把有效密钥');const name=String(body.name||'我的项目').trim().slice(0,64);if(!name)throw problem(400,'invalid_name','请填写项目名称');const budget=body.budget===undefined?0:Number(body.budget);if(!Number.isFinite(budget)||budget<0||budget>100000)throw problem(400,'invalid_budget','密钥预算需要在 0 至 100000 之间');const plain=`sk-relay-${randomBytes(24).toString('base64url')}`;const key={id:randomUUID(),user_id:user.id,name,key_hash:hash(plain),suffix:plain.slice(-6),enabled:true,rpm:Math.min(120,Math.max(1,Number(body.rpm)||60)),budget_micro:micro(budget),portal_used_micro:0,quota_usd:0,used_usd:0,group_id:null,created_at:clock(),last_used_at:null};store.data.keys.push(key);sendJson(res,201,{...keyView(key),key:plain});return true;});
    }
    const keyMatch=/^\/portal\/keys\/([^/]+)$/.exec(path);
    if(keyMatch&&['PATCH','DELETE'].includes(req.method)){const body=req.method==='PATCH'?await parse(req):{};return await serial(async()=>{const {user}=requireUser(req);const key=ownKey(user,keyMatch[1]);if(req.method==='DELETE'){key.enabled=false;key.revoked_at=clock();}else{if(body.name!==undefined){const name=String(body.name).trim().slice(0,64);if(!name)throw problem(400,'invalid_name','请填写项目名称');key.name=name;}if(body.enabled!==undefined)key.enabled=body.enabled===true;}sendJson(res,200,{ok:true,...keyView(key)});return true;});}
    if(req.method==='GET'&&path==='/portal/usage'){const query=new URL(req.url,origin).searchParams;let rows=data().requests.filter(row=>row.user_id===user.id).toReversed();if(query.get('model'))rows=rows.filter(row=>row.model===query.get('model'));if(query.get('status')==='ok')rows=rows.filter(row=>row.status<400);if(query.get('status')==='error')rows=rows.filter(row=>row.status>=400);sendJson(res,200,pageOf(req,rows.map(({user_id,...row})=>row)));return true;}
    if(req.method==='GET'&&path==='/portal/ledger'){sendJson(res,200,pageOf(req,data().ledger.filter(row=>row.user_id===user.id).toReversed().map(({user_id,...row})=>row)));return true;}
    if(req.method==='POST'&&path==='/portal/redeem'){
      const body=await parse(req),code=String(body.code||'').trim().toUpperCase();return await serial(async()=>{const {user}=requireUser(req);limit(`redeem:${user.id}`,10,600_000);const item=store.data.redeem.find(item=>item.code===code&&!item.used);if(!item||!Number.isFinite(Number(item.amount))||Number(item.amount)<=0)throw problem(400,'redeem_invalid','兑换码无效或已使用');const amount=micro(item.amount);user.balance_micro=balance(user)+amount;item.used=true;item.used_by=user.email;item.used_at=clock();item.portal_user_id=user.id;ledgerAdd(user,'redeem',amount,item.note||'兑换码入账',`redeem:${item.id}`);sendJson(res,200,{ok:true,amount:units(amount),balance:units(balance(user))});return true;});
    }
    if(req.method==='POST'&&path==='/portal/password'){
      const body=await parse(req),password=requirePassword(body.newPassword);return await serial(async()=>{const {user,session}=requireUser(req);if(!await passwordMatches(body.currentPassword,user.password_hash))throw problem(400,'invalid_current_password','当前密码不正确');user.password_hash=await passwordHash(password);data().sessions=data().sessions.filter(item=>item.user_id!==user.id||item.hash===session.hash);sendJson(res,200,{ok:true});return true;});
    }
    return false;
  }

  async function handle(req,res,path,parse){if(path!=='/portal'&&!path.startsWith('/portal/'))return false;try{const handled=await route(req,res,path,parse);if(!handled)sendJson(res,404,{error:{code:'not_found',message:'未找到该账户接口'}});return true;}catch(error){sendJson(res,error.status||500,{error:{code:error.code||'portal_error',message:error.status?error.message:'账户服务暂时不可用'}});return true;}}

  async function handleAdmin(req,res,path,parse){
    if((path!=='/admin/api/users'&&!path.startsWith('/admin/api/users/'))&&path!=='/admin/api/portal-settings'&&path!=='/admin/api/payment'&&!path.startsWith('/admin/api/user-groups'))return false;
    try{
      if(await payments.handleAdmin(req,res,path,parse))return true;
      if(!adminAuthorized(req))throw problem(403,'admin_required','需要管理员身份');guardWrite(req);
      const settingsView=async()=>({mailReady:await ready(),billingReady:billingReady(),registration_enabled:data().settings.registration_enabled!==false,...await registrationMetadata(),userCount:data().users.length,billing_currency:data().settings.billing_currency,credit_unit_cny:data().settings.credit_unit_cny,...billingMetadata()});
      // note: user groups live in the shared `groups` array with kind='user'. `models` is the
      // allowed model list ('*' = any) and `rate_multiplier` scales every price for members (1 = list price).
      const userGroupView=group=>{const members=data().users.filter(user=>user.group_id===group.id);return{id:group.id,name:group.name,kind:'user',models:Array.isArray(group.models)&&group.models.length?group.models:['*'],rate_multiplier:rateMultiplier(group),note:String(group.note||''),enabled:group.enabled!==false,created_at:group.created_at||null,member_count:members.length,members:members.slice(0,50).map(user=>user.email)};};
      const userGroups=()=>(store.data.groups||[]).filter(group=>group.kind==='user');
      if(path==='/admin/api/user-groups'&&req.method==='GET'){sendJson(res,200,{items:userGroups().map(userGroupView),currency:'USD',multiplier_basis:'multiplier = billed price / list price, 1 = list price'});return true;}
      if(path==='/admin/api/user-groups'&&req.method==='POST'){const body=await parse(req);return await serial(async()=>{if(!adminAuthorized(req))throw problem(403,'admin_required','需要管理员身份');const name=String(body.name||'').trim().slice(0,60);if(!name)throw problem(400,'invalid_group_name','请填写分组名称');if((store.data.groups||[]).some(group=>group.kind==='user'&&group.name.toLowerCase()===name.toLowerCase()))throw problem(409,'group_exists','已存在同名分组');const multiplier=body.rate_multiplier===undefined?1:Number(body.rate_multiplier);if(!Number.isFinite(multiplier)||multiplier<0.1||multiplier>100)throw problem(400,'invalid_multiplier','倍率需要在 0.1 至 100 之间');const models=Array.isArray(body.models)&&body.models.length?body.models.map(String):['*'];const group={id:randomUUID(),kind:'user',name,models,rate_multiplier:Math.round(multiplier*100)/100,note:String(body.note||'').slice(0,200),enabled:body.enabled!==false,created_at:clock()};store.data.groups.push(group);sendJson(res,201,userGroupView(group));return true;});}
      const groupMatch=/^\/admin\/api\/user-groups\/([^/]+)$/.exec(path);
      if(groupMatch){const id=groupMatch[1];return await serial(async()=>{if(!adminAuthorized(req))throw problem(403,'admin_required','需要管理员身份');const group=store.data.groups.find(item=>item.id===id&&item.kind==='user');if(!group)throw problem(404,'group_not_found','未找到分组');if(req.method==='PATCH'){const body=await parse(req);if(body.name!==undefined){const name=String(body.name).trim().slice(0,60);if(!name)throw problem(400,'invalid_group_name','请填写分组名称');group.name=name;}if(body.models!==undefined)group.models=Array.isArray(body.models)&&body.models.length?body.models.map(String):['*'];if(body.rate_multiplier!==undefined){const multiplier=Number(body.rate_multiplier);if(!Number.isFinite(multiplier)||multiplier<0.1||multiplier>100)throw problem(400,'invalid_multiplier','倍率需要在 0.1 至 100 之间');group.rate_multiplier=Math.round(multiplier*100)/100;}if(body.note!==undefined)group.note=String(body.note).slice(0,200);if(body.enabled!==undefined)group.enabled=body.enabled===true;sendJson(res,200,userGroupView(group));return true;}if(req.method==='DELETE'){store.data.groups=store.data.groups.filter(item=>item.id!==group.id);for(const user of data().users)if(user.group_id===group.id)user.group_id=null;sendJson(res,200,{ok:true});return true;}return false;});}
      if(req.method==='GET'&&path==='/admin/api/users'){sendJson(res,200,{items:data().users.map(summarize),groups:userGroups().map(group=>({id:group.id,name:group.name,rate_multiplier:rateMultiplier(group),enabled:group.enabled!==false,models:group.models||['*']}))});return true;}
      if(req.method==='GET'&&path==='/admin/api/portal-settings'){sendJson(res,200,await settingsView());return true;}
      if(req.method==='PUT'&&path==='/admin/api/portal-settings'){
        const body=await parse(req);
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length===0||Object.keys(body).some(field=>!['billing_currency','credit_unit_cny','registration_mode'].includes(field)))throw problem(400,'invalid_portal_settings','账户设置包含无效字段');
        const billing=Object.hasOwn(body,'billing_currency')||Object.hasOwn(body,'credit_unit_cny');
        if(billing&&(!Object.hasOwn(body,'billing_currency')||!Object.hasOwn(body,'credit_unit_cny')||!(body.billing_currency==='CNY'&&body.credit_unit_cny===1||body.billing_currency===null&&body.credit_unit_cny===null)))throw problem(400,'invalid_billing_currency','计费设置需同时填写 CNY 与每额度 1 元，或同时清空');
        if(Object.hasOwn(body,'registration_mode')&&!['email_code','email_password'].includes(body.registration_mode))throw problem(400,'invalid_registration_mode','注册方式需要为邮箱验证码或邮箱密码');
        return await serial(async()=>{if(!adminAuthorized(req))throw problem(403,'admin_required','需要管理员身份');if(billing){data().settings.billing_currency=body.billing_currency;data().settings.credit_unit_cny=body.credit_unit_cny;}if(Object.hasOwn(body,'registration_mode'))data().settings.registration_mode=body.registration_mode;sendJson(res,200,await settingsView());return true;});
      }
      const match=/^\/admin\/api\/users\/([^/]+)(?:\/(credit))?$/.exec(path);if(!match)return false;
      const user=data().users.find(user=>user.id===match[1]);if(!user)throw problem(404,'user_not_found','未找到用户');
      if(req.method==='GET'&&!match[2]){const keys=store.data.keys.filter(key=>key.user_id===user.id).map(keyView);sendJson(res,200,{user:summarize(user),group:user.group_id?userGroupView(groupFor(user.group_id)):null,keys,group_options:userGroups().map(group=>({id:group.id,name:group.name,rate_multiplier:rateMultiplier(group),enabled:group.enabled!==false}))});return true;}
      if(req.method==='POST'&&match[2]==='credit'){const body=await parse(req),amount=Number(body.amount);if(!Number.isFinite(amount)||amount<=0||amount>100000||micro(amount)<1)throw problem(400,'invalid_amount','额度需要大于 0 且不超过 100000');return await serial(async()=>{if(!adminAuthorized(req))throw problem(403,'admin_required','需要管理员身份');const user=data().users.find(item=>item.id===match[1]);if(!user)throw problem(404,'user_not_found','未找到用户');const before=units(balance(user));const ref=body.reference?`admin:${String(body.reference).slice(0,100)}`:`admin:${clock()}:${randomUUID()}`;let credited=0;const existing=data().ledger.find(row=>row.reference===ref&&row.user_id===user.id);if(!existing){user.balance_micro=balance(user)+micro(amount);credited=micro(amount);ledgerAdd(user,'admin_credit',micro(amount),String(body.note||'管理员加额'),ref);}
        // note: every credit is audited with who/when/target/amount/basis and the before/after balance.
        if(credited)data().audit=(data().audit||[]).concat({ts:clock(),actor:'admin',action:'credit user',target:user.email,target_id:user.id,target_type:'user',amount_usd:units(credited),before_usd:before,after_usd:units(balance(user)),currency:'USD',basis:'用户余额（USD 等值，1 USD = 1,000,000 micro-credits）',note:String(body.note||'').slice(0,200),reference:ref,ip:requestIp(req)}).slice(-500);
        sendJson(res,200,{ok:true,user:summarize(user),before,after:units(balance(user)),added:units(credited),credited:credited>0,reference:ref,audit:{actor:'admin',action:'credit user',target:user.email,basis:'user balance',amount:units(credited),note:String(body.note||'').slice(0,200)}});return true;});}
      if(req.method==='PATCH'&&!match[2]){const body=await parse(req);return await serial(async()=>{if(!adminAuthorized(req))throw problem(403,'admin_required','需要管理员身份');const user=data().users.find(item=>item.id===match[1]);if(!user)throw problem(404,'user_not_found','未找到用户');const beforeGroup=user.group_id||null;if(body.group_id!==undefined){const id=body.group_id?String(body.group_id):null;if(id&&!userGroups().some(group=>group.id===id))throw problem(400,'invalid_group','未找到该用户分组');user.group_id=id;}if(body.disabled!==undefined){user.disabled=body.disabled===true;if(user.disabled)data().sessions=data().sessions.filter(session=>session.user_id!==user.id);}if(beforeGroup!==(user.group_id||null))data().audit=(data().audit||[]).concat({ts:clock(),actor:'admin',action:'assign user group',target:user.email,target_id:user.id,target_type:'user',group_id:user.group_id,group_name:groupFor(user.group_id)?.name||null,previous_group_id:beforeGroup,ip:requestIp(req)}).slice(-500);sendJson(res,200,{ok:true,user:summarize(user)});return true;});}
      return false;
    }catch(error){sendJson(res,error.status||500,{error:{code:error.code||'portal_error',message:error.status?error.message:'账户服务暂时不可用'}});return true;}
  }

  function userForKey(key){return key?.user_id?data().users.find(user=>user.id===key.user_id)||null:null;}
  async function authorizeKey(key,model,body={},path='/v1/chat/completions'){
    if(!key?.user_id)return null;
    return await serial(async()=>{key=store.data.keys.find(item=>item.id===key.id&&item.user_id===key.user_id);const user=userForKey(key);if(!key||!accountActive(user)||user.disabled||key.enabled===false||key.revoked_at)throw problem(403,'account_unavailable','账户或密钥不可用');const rates=ratesFor(model);if(!rates)throw problem(503,'model_pricing_pending','模型暂未定价，请等待价格发布');if(balance(user)-held(user.id)<=0)throw problem(402,'balance_insufficient','账户可用额度不足');
      // note: the user's group can restrict models and scale the billed rate (multiplier shown in the invoice row).
      const group=groupFor(user.group_id);if(group&&group.enabled===false)throw problem(403,'group_disabled','所属分组已停用，请联系管理员');if(group&&Array.isArray(group.models)&&group.models.length&&!group.models.includes('*')&&!group.models.includes(model))throw problem(403,'model_not_allowed','当前账户分组不支持该模型');
      const multiplier=rateMultiplier(group),scaled={in:rates.in*multiplier,out:rates.out*multiplier,cache:rates.cache*multiplier};
      user.last_active_at=clock();
      if(['n','best_of'].some(field=>body[field]!==undefined&&Number(body[field])!==1))throw problem(400,'unsupported_generation_count','账户密钥每次请求仅支持生成一份结果');
      if(body.background!==undefined&&body.background!==false)throw problem(400,'unsupported_async_execution','账户密钥仅支持同步执行，请移除 background 或设为 false');
      const embedding=path==='/v1/embeddings';const raw=embedding?0:Number(body.max_completion_tokens??body.max_tokens??body.max_output_tokens??1024);if(!embedding&&(!Number.isFinite(raw)||raw<1||raw>8192))throw problem(400,'invalid_output_limit','最大输出需要在 1 至 8192 之间');const output=embedding?0:Math.floor(raw);if(!embedding){if(path==='/v1/responses')body.max_output_tokens=output;else{body.max_tokens=output;if(body.max_completion_tokens!==undefined)body.max_completion_tokens=output;}}if(!embedding&&path!=='/v1/chat/completions'&&path!=='/v1/responses')throw problem(400,'unsupported_endpoint','此账户密钥仅支持文本对话、Responses 与嵌入接口');const serializedBody=JSON.stringify(body);if(/\"(?:type)\"\s*:\s*\"(?:image_url|input_image|input_audio|audio|video|file|input_file)\"|\"(?:image_url|input_audio|audio|video|file_id)\"\s*:/.test(serializedBody))throw problem(400,'unsupported_input','当前账户仅支持文本输入，请移除图片、音频或文件内容');
      const inputBytes=Buffer.byteLength(serializedBody,'utf8');const inputTokens=Math.max(1,inputBytes+2048);const estimated=Math.max(1,Math.ceil(inputTokens*(scaled.in+scaled.cache)+output*scaled.out));const available=balance(user)-held(user.id);if(estimated>available)throw problem(402,'balance_insufficient','额度不足以完成本次请求，请缩短输入或减少最大输出');if(Number(key.budget_micro)>0&&Number(key.portal_used_micro||0)+held(user.id,key.id)+estimated>key.budget_micro)throw problem(402,'key_budget_exhausted','项目密钥预算不足');const id=randomUUID();const reservation={id,user_id:user.id,key_id:key.id,key_name:key.name,key_hint:keyHint(key),model,amount_micro:estimated,rates:scaled,list_rates:rates,multiplier,group_id:group?.id||null,group_name:group?.name||null,created_at:clock(),started_at:now(),output_limit:output};data().reservations.push(reservation);return{id,user_id:user.id,key_id:key.id,model,amount:units(estimated),max_output_tokens:output};});
  }
  async function release(reservation){if(!reservation)return;return await serial(async()=>{data().reservations=data().reservations.filter(item=>item.id!==reservation.id);});}
  async function settle(reservation,usage={},result={}){
    if(!reservation)return null;
    return await serial(async()=>{const saved=data().reservations.find(item=>item.id===reservation.id);if(!saved)return null;data().reservations=data().reservations.filter(item=>item.id!==saved.id);const user=data().users.find(user=>user.id===saved.user_id),key=store.data.keys.find(key=>key.id===saved.key_id);if(!user)return null;const metadata=typeof result==='number'?{status:result}:result||{},status=Number(metadata.status)||200;const input=Math.max(0,Number(usage.prompt_tokens??usage.input_tokens)||0),output=Math.max(0,Number(usage.completion_tokens??usage.output_tokens)||0),cache=Math.max(0,Number(usage.cache_read_tokens??usage.prompt_tokens_details?.cached_tokens)||0);const actual=status<400?Math.max(0,Math.ceil(input*saved.rates.in+output*saved.rates.out+cache*saved.rates.cache)):0;const maxCharge=Math.max(0,balance(user)-held(user.id));const charged=Math.min(actual,maxCharge);user.balance_micro=balance(user)-charged;user.spent_micro=Number(user.spent_micro||0)+charged;if(key)key.portal_used_micro=Number(key.portal_used_micro||0)+charged;const row={id:randomUUID(),user_id:user.id,key_id:saved.key_id,key_name:saved.key_name,ts:clock(),model:saved.model,prompt_tokens:input,completion_tokens:output,cache_read_tokens:cache,cost:units(charged),status,latency_ms:Math.max(0,Number(metadata.latency_ms)||now()-saved.started_at),estimated:usage.estimated===true};if(charged!==actual){row.actual_cost=units(actual);row.billing_anomaly=true;}data().requests.push(row);if(data().requests.length>5000)data().requests.splice(0,data().requests.length-5000);if(charged)ledgerAdd(user,'usage',-charged,`模型调用 ${saved.model}`,`request:${saved.id}`);return{cost:units(charged),balance:units(balance(user)),request_id:row.id,key_id:saved.key_id,key_hint:saved.key_hint||keyHint(key),user_id:saved.user_id,billing_anomaly:row.billing_anomaly===true,multiplier:saved.multiplier??1,group_name:saved.group_name||null};});
  }
  return {handle,handleAdmin,authorizeKey,settle,release,userForKey,billingMetadata,accountActive};
}
