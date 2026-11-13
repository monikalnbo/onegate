(() => {
  'use strict';
  window.RSViews.mail = {
    title:'注册邮件', sub:'真实 SMTP 发信配置与连接验证', icon:'mail',
    async mount(root){
      const RS=window.RS;let config={};
      async function load(){config=await RS.api('mail');render();}
      function render(){
        root.innerHTML=`<div class="page-stack"><section class="card"><div class="card-header"><div><h2 class="card-title">邮箱验证服务</h2><p class="card-sub">注册验证码和找回密码由此服务真实发送。</p></div><span class="badge ${config.ready?'badge-green':'badge-amber'}">${config.ready?'可用':'待配置或验证'}</span></div><div class="card-body"><form id="mailSettings"><div class="grid grid-cols-2 gap-4"><div class="field"><label class="input-label" for="smtpHost">SMTP 服务器</label><input class="input" id="smtpHost" name="host" required value="${RS.esc(config.host||'')}" placeholder="发信服务商提供的 SMTP 地址"></div><div class="field"><label class="input-label" for="smtpPort">连接方式</label><select class="select" id="smtpPort" name="port"><option value="465"${Number(config.port||465)===465?' selected':''}>465 · 加密连接</option><option value="587"${Number(config.port)===587?' selected':''}>587 · STARTTLS</option></select></div><div class="field"><label class="input-label" for="smtpUser">发信账号</label><input class="input" id="smtpUser" name="username" autocomplete="off" required value="${RS.esc(config.username||'')}"></div><div class="field"><label class="input-label" for="smtpPassword">SMTP 密码或授权码</label><input class="input" id="smtpPassword" name="password" type="password" autocomplete="new-password" placeholder="${config.password_configured?'已保存；留空保持原值':'填写发信服务的授权码'}"><p class="input-hint">凭据在服务器加密保存，不会回显。</p></div><div class="field"><label class="input-label" for="smtpFrom">发件邮箱</label><input class="input" id="smtpFrom" name="from" type="email" required value="${RS.esc(config.from||'')}"></div><div class="field"><label class="input-label" for="smtpFromName">发件人名称</label><input class="input" id="smtpFromName" name="fromName" maxlength="80" value="${RS.esc(config.fromName||'OneGate')}"></div></div><label class="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" ${config.enabled?'checked':''}>启用邮箱验证与找回密码邮件</label><div class="toolbar mt-4"><button class="btn btn-primary" type="submit">${RS.icon('check')} 保存配置</button><button class="btn btn-secondary" type="button" id="verifySmtp">${RS.icon('zap')} 验证 SMTP 连接</button></div><p id="mailMessage" class="input-hint mt-3" aria-live="polite">${config.last_verified_at?'最近连接验证：'+RS.when(config.last_verified_at):'请先保存配置，再验证连接。验证不发送邮件。'}</p></form></div></section><section class="card"><div class="card-header"><h2 class="card-title">发送测试邮件</h2></div><div class="card-body"><form id="mailTest"><div class="field"><label class="input-label" for="mailTestTo">测试收件邮箱</label><input class="input" id="mailTestTo" type="email" name="to" required placeholder="填写你能检查收件箱的邮箱"></div><button class="btn btn-secondary" type="submit" ${config.ready?'':'disabled'}>发送一封测试邮件</button><p class="input-hint">提交后会向上方邮箱实际发信。SMTP 接受不等于已进入收件箱，请检查收件结果。</p></form></div></section><section class="card"><div class="card-body"><p class="text-sm muted">邮件未就绪时，主站会明确提示注册暂未开放，不会返回假验证码。发件域名应按邮件服务商要求配置 SPF、DKIM 和 DMARC；当前服务器的直连 25 端口不可用，使用 465 或 587 发信服务。</p></div></section></div>`;
        root.querySelector('#mailSettings').addEventListener('submit',async event=>{
          event.preventDefault();const form=event.target;const data=new FormData(form);const port=Number(data.get('port'));const body={host:String(data.get('host')).trim(),port,secure:port===465,username:String(data.get('username')).trim(),password:String(data.get('password')),from:String(data.get('from')).trim(),fromName:String(data.get('fromName')).trim(),enabled:data.has('enabled')};const button=form.querySelector('[type=submit]');button.disabled=true;
          try{await RS.api('mail',{method:'PUT',body});form.querySelector('#smtpPassword').value='';await load();RS.toast('配置已保存，请验证连接');}catch(error){root.querySelector('#mailMessage').textContent=error.message;button.disabled=false;}
        });
        root.querySelector('#verifySmtp').addEventListener('click',async event=>{
          const button=event.currentTarget;button.disabled=true;root.querySelector('#mailMessage').textContent='正在验证 SMTP 加密连接与身份…';
          try{await RS.api('mail/verify',{method:'POST',body:{}});await load();RS.toast('SMTP 连接与身份验证通过');}catch(error){root.querySelector('#mailMessage').textContent=error.message;button.disabled=false;}
        });
        root.querySelector('#mailTest').addEventListener('submit',async event=>{
          event.preventDefault();const form=event.target,button=form.querySelector('button');button.disabled=true;
          try{const to=String(new FormData(form).get('to')).trim();await RS.api('mail/test',{method:'POST',body:{to}});RS.toast('测试邮件已交给 SMTP 服务，请检查收件箱');}catch(error){RS.toast(error.message,'error');}finally{button.disabled=false;}
        });
      }
      await load();
    }
  };
})();
