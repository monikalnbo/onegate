(() => {
  'use strict';
  window.RSViews.customers = {
    title:'用户管理', sub:'邮箱账户、可用额度与使用状态', icon:'users',
    async mount(root) {
      const RS=window.RS;
      let users=[],meta={};
      async function load(){
        const [response,settings]=await Promise.all([RS.api('users'),RS.api('portal-settings')]);
        users=Array.isArray(response)?response:response.items||[];meta=settings||{};render();
      }
      function number(value){return Number(value||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:6});}
      function render(){
        root.innerHTML=`<div class="page-stack"><div class="grid grid-cols-4 gap-4"><article class="card stat-card"><div><div class="stat-label">注册用户</div><div class="stat-value">${users.length}</div></div></article><article class="card stat-card"><div><div class="stat-label">已验证邮箱</div><div class="stat-value">${users.filter(user=>user.verified).length}</div></div></article><article class="card stat-card"><div><div class="stat-label">邮件注册</div><div class="stat-value small">${meta.mailReady?'已就绪':'待配置'}</div></div></article><article class="card stat-card"><div><div class="stat-label">账户状态</div><div class="stat-value small">${users.filter(user=>!user.disabled).length} 个可用</div></div></article></div><section class="card"><div class="card-header"><div><h2 class="card-title">客户账户</h2><p class="card-sub">额度通过实际兑换或管理员发放，金额不代表已接入支付。</p></div><button class="btn btn-secondary btn-sm" id="customersRefresh">${RS.icon('refresh')} 刷新</button></div><div class="table-wrap"><table class="table"><thead><tr><th>邮箱</th><th>验证</th><th class="num">可用额度</th><th class="num">累计消费</th><th>注册时间</th><th>状态</th><th class="num">操作</th></tr></thead><tbody>${users.length?users.map(user=>`<tr data-user="${RS.esc(user.id)}"><td class="strong">${RS.esc(user.email)}</td><td><span class="badge ${user.verified?'badge-green':'badge-amber'}">${user.verified?'已验证':'待验证'}</span></td><td class="num mono">${number(user.balance)}</td><td class="num mono">${number(user.spent)}</td><td class="mono">${RS.when(user.created_at)}</td><td><span class="badge ${user.disabled?'badge-gray':'badge-green'}">${user.disabled?'已停用':'可用'}</span></td><td class="num"><div class="inline-flex gap-2"><button class="btn btn-secondary btn-sm" data-credit="${RS.esc(user.id)}">发放额度</button><button class="btn btn-secondary btn-sm" data-toggle-user="${RS.esc(user.id)}">${user.disabled?'启用':'停用'}</button></div></td></tr>`).join(''):'<tr><td colspan="7"><div class="empty"><b>还没有客户账户</b><span>邮件服务配置就绪后，用户可从主站注册并验证邮箱。</span></div></td></tr>'}</tbody></table></div></section><section class="card"><div class="card-header"><h2 class="card-title">开通顺序</h2></div><div class="card-body"><p class="text-sm muted">配置邮件并验证连接 → 设置模型单价 → 用户注册验证 → 发放或兑换额度 → 用户创建自己的 API Key。</p><div class="toolbar mt-4"><a class="btn btn-secondary btn-sm" href="#/mail">配置注册邮件</a><a class="btn btn-secondary btn-sm" href="#/settings">设置模型单价</a><a class="btn btn-secondary btn-sm" href="#/redeem">管理兑换码</a></div></div></section></div>`;
        root.querySelector('#customersRefresh').addEventListener('click',load);
        root.querySelectorAll('[data-credit]').forEach(button=>button.addEventListener('click',()=>credit(button.dataset.credit)));
        root.querySelectorAll('[data-toggle-user]').forEach(button=>button.addEventListener('click',async()=>{
          const user=users.find(user=>user.id===button.dataset.toggleUser);if(!user)return;
          const confirm=await RS.confirmDialog({title:user.disabled?'启用账户':'停用账户',message:`${user.disabled?'恢复':'暂停'} ${user.email} 的账户与关联 API 调用？`,danger:!user.disabled});
          if(!confirm)return;
          try{await RS.api('users/'+encodeURIComponent(user.id),{method:'PATCH',body:{disabled:!user.disabled}});await load();RS.toast('账户状态已更新');}catch(error){RS.toast(error.message,'error');}
        }));
      }
      function credit(id){
        const user=users.find(user=>user.id===id);if(!user)return;
        const reference=crypto.randomUUID();
        const modal=RS.modal({title:'发放客户额度',sub:user.email,body:`<form id="customer-credit-form"><div class="field"><label class="input-label" for="customer-credit-amount">额度</label><input id="customer-credit-amount" class="input" name="amount" type="number" min="0.000001" max="100000" step="0.000001" required></div><div class="field"><label class="input-label" for="customer-credit-note">备注</label><input id="customer-credit-note" class="input" name="note" maxlength="180" required placeholder="记录实际发放原因"></div><p class="input-hint">提交后立即计入用户的真实额度流水。</p><p id="creditError" class="field-error" role="alert"></p></form>`,footer:'<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" type="submit" form="customer-credit-form">确认发放</button>'});
        modal.querySelector('[data-cancel]').addEventListener('click',RS.closeModal);
        modal.querySelector('form').addEventListener('submit',async event=>{
          event.preventDefault();if(event.target.dataset.busy==='true')return;event.target.dataset.busy='true';const data=new FormData(event.target);const submit=modal.querySelector('[type=submit]');submit.disabled=true;
          try{await RS.api('users/'+encodeURIComponent(id)+'/credit',{method:'POST',body:{amount:Number(data.get('amount')),note:String(data.get('note')),reference}});RS.closeModal();await load();RS.toast('额度已发放并记入流水');}catch(error){modal.querySelector('#creditError').textContent=error.message;event.target.dataset.busy='false';submit.disabled=false;}
        });
      }
      await load();
    }
  };
})();
