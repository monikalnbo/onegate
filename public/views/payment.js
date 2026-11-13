(() => {
  'use strict';
  const METHODS = [['alipay','支付宝'],['wxpay','微信支付']];
  const number = value => Number(value ?? 0).toLocaleString('zh-CN',{maximumFractionDigits:6});
  window.RSViews.payment = {
    title:'收款设置',sub:'在线支付渠道、入账换算与回调地址',icon:'wallet',
    async mount(root) {
      const RS=window.RS;
      let config={};
      async function load() {config=await RS.api('payment');render();}
      function render() {
        const methods=Array.isArray(config.methods)?config.methods:[];
        root.innerHTML=`<div class="page-stack"><section class="card"><div class="card-header"><div><h2 class="card-title">在线收款</h2><p class="card-sub">填写真实商户资料后，再向客户开放在线充值。</p></div><span class="badge ${config.ready?'badge-green':'badge-amber'}">${config.ready?'已开放':'未开放'}</span></div><div class="card-body"><form id="paymentSettings"><div class="grid grid-cols-2 gap-4"><div class="field"><label class="input-label" for="paymentGateway">支付网关地址</label><input class="input" id="paymentGateway" name="gateway_url" type="url" value="${RS.esc(config.gateway_url||'')}" placeholder="https://支付服务商网关地址" autocomplete="url"><p class="input-hint">填写支付服务商提供的 HTTPS 网关地址。</p></div><div class="field"><label class="input-label" for="paymentMerchant">商户 ID</label><input class="input" id="paymentMerchant" name="merchant_id" inputmode="numeric" pattern="[0-9]{1,32}" maxlength="32" value="${RS.esc(config.merchant_id||'')}" autocomplete="off"></div><div class="field"><label class="input-label" for="paymentSecret">商户密钥</label><input class="input" id="paymentSecret" name="merchant_key" type="password" autocomplete="new-password" placeholder="${config.merchant_key_configured?'已保存；留空保持原值':'填写支付服务商提供的商户密钥'}"><p class="input-hint">只用于服务器签名验证，保存后不回显。</p></div><fieldset class="field" style="min-width:0;border:0;padding:0;margin:0"><legend class="input-label">开放的支付方式</legend><div class="flex flex-wrap gap-4" style="padding:11px 0">${METHODS.map(([id,label])=>`<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="methods" value="${id}"${methods.includes(id)?' checked':''}>${label}</label>`).join('')}</div><p class="input-hint">只选择商户已实际开通的方式。</p></fieldset><div class="field"><label class="input-label" for="paymentMinimum">最低充值金额（人民币元）</label><input class="input" id="paymentMinimum" name="min_amount_cny" type="number" min="0.01" max="100000" step="0.01" value="${RS.esc(config.min_amount_cny??1)}" required></div><div class="field"><label class="input-label" for="paymentMaximum">最高充值金额（人民币元）</label><input class="input" id="paymentMaximum" name="max_amount_cny" type="number" min="0.01" max="100000" step="0.01" value="${RS.esc(config.max_amount_cny??1000)}" required></div><div class="field"><label class="input-label" for="paymentRate">每 1 元到账额度</label><input class="input" id="paymentRate" name="credits_per_cny" type="number" min="0.0001" step="0.0001" value="${RS.esc(config.credits_per_cny??'')}" placeholder="先确定每 1 元到账多少额度"><p class="input-hint" id="paymentConversion">${config.credits_per_cny==null?'尚未设置到账换算，在线支付保持关闭。':'支付 1 元到账 '+number(config.credits_per_cny)+' 额度单位。模型价格仍按额度计价。'}</p></div></div><label class="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled"${config.enabled?' checked':''}>向客户开放在线支付</label><p class="input-hint">启用前确认商户、支付方式和回调地址。保存本页不会创建订单、发起扣款或发送测试支付。</p><p id="paymentError" class="field-error" role="alert"></p><div class="toolbar mt-4"><button class="btn btn-primary" type="submit">${RS.icon('check')} 保存收款设置</button></div><p id="paymentMessage" class="input-hint mt-3" aria-live="polite">${config.ready?'客户钱包可按已配置方式创建真实支付订单。':'在线支付当前未开放；客户仍可使用有效兑换码或联系运营补充额度。'}</p></form></div></section><section class="card"><div class="card-header"><div><h2 class="card-title">支付回调</h2><p class="card-sub">将以下地址按支付服务商要求配置。回调验签后才会入账。</p></div></div><div class="card-body"><div class="field"><label class="input-label" for="paymentNotify">异步通知地址</label><div class="flex gap-2"><input id="paymentNotify" class="input mono flex-1" style="width:0" readonly value="${RS.esc(config.notify_url||'')}" aria-describedby="paymentNotifyHint"><button class="btn btn-secondary" type="button" data-copy-notify aria-label="复制异步通知地址"${config.notify_url?'':' disabled'}>${RS.icon('copy')}</button></div><p class="input-hint" id="paymentNotifyHint">确认签名、商户号、订单金额与支付成功状态后，服务器才增加账户额度。</p></div><div class="field"><label class="input-label" for="paymentReturn">支付返回地址</label><input id="paymentReturn" class="input mono" readonly value="${RS.esc(config.return_url||'')}"><p class="input-hint">返回页面用于查看订单结果；打开返回地址不会触发入账。</p></div></div></section></div>`;
        const form=root.querySelector('#paymentSettings');
        const rate=root.querySelector('#paymentRate');
        rate.addEventListener('input',()=>{root.querySelector('#paymentConversion').textContent=rate.value===''?'尚未设置到账换算，在线支付保持关闭。':`支付 1 元到账 ${number(rate.value)} 额度单位。模型价格仍按额度计价。`;});
        root.querySelector('[data-copy-notify]').addEventListener('click',event=>RS.copy(config.notify_url,event.currentTarget));
        form.addEventListener('submit',async event=>{
          event.preventDefault();if(form.dataset.busy==='true'||!form.reportValidity())return;
          const data=new FormData(form),enabled=data.has('enabled'),selected=data.getAll('methods').map(String);
          const body={enabled,gateway_url:String(data.get('gateway_url')||'').trim(),merchant_id:String(data.get('merchant_id')||'').trim(),merchant_key:String(data.get('merchant_key')||''),methods:selected,min_amount_cny:Number(data.get('min_amount_cny')),max_amount_cny:Number(data.get('max_amount_cny')),credits_per_cny:Number(data.get('credits_per_cny'))};
          const rateEmpty=String(data.get('credits_per_cny')||'').trim()==='';if(rateEmpty)delete body.credits_per_cny;
          const error=root.querySelector('#paymentError');error.textContent='';
          if(![body.min_amount_cny,body.max_amount_cny,...(rateEmpty?[]:[body.credits_per_cny])].every(value=>Number.isFinite(value)&&value>0)){error.textContent='金额与到账额度需要是大于 0 的有效数值。';return;}
          if(body.max_amount_cny>100000||body.min_amount_cny>100000){error.textContent='充值金额不得超过 100000 元。';return;}
          if(!selected.length){error.textContent='请至少选择一种商户已开通的支付方式。';return;}
          if(body.merchant_id&&!/^[0-9]{1,32}$/.test(body.merchant_id)){error.textContent='商户 ID 需要是最多 32 位数字。';return;}
          if(!rateEmpty&&Math.abs(body.credits_per_cny*10000-Math.round(body.credits_per_cny*10000))>0.000001){error.textContent='到账额度最多保留 4 位小数。';return;}
          if(body.max_amount_cny<body.min_amount_cny){error.textContent='最高充值金额需要大于或等于最低金额。';return;}
          if(enabled&&(rateEmpty||!body.gateway_url||!body.merchant_id||!selected.length||!body.merchant_key&&!config.merchant_key_configured)){error.textContent='开放支付前，请填写网关、商户 ID、密钥并选择支付方式。';return;}
          if(body.gateway_url){try{const parsed=new URL(body.gateway_url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error();}catch{error.textContent='请填写有效的 HTTPS 支付网关地址。';return;}}
          form.dataset.busy='true';const submit=form.querySelector('[type=submit]');submit.disabled=true;
          try {await RS.api('payment',{method:'PUT',body});root.querySelector('#paymentSecret').value='';await load();if(root.isConnected)RS.toast('收款设置已保存');}
          catch(failure){error.textContent=failure.message||'收款设置保存未完成，请重试。';}
          finally{body.merchant_key='';form.querySelector('#paymentSecret').value='';if(form.isConnected){form.dataset.busy='false';submit.disabled=false;}}
        });
      }
      await load();
    }
  };
})();
