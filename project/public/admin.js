const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tab='agent';
// This page deliberately does not load app.js or the full dashboard dataset.
// Keep the shared outbox's rendering helpers available in this standalone boot.
const name=code=>outreachPublic.directory?.countries?.find(c=>c.code===code)?.name||code;
function options(list,value){return list.map(([v,l])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`).join('')}
outreachState.adminPage=typeof location!=='undefined'&&location.hash==='#outbox'?'outbox':typeof location!=='undefined'&&location.hash==='#dialogue'?'dialogue':'mail';
function render(){
 try{$('admin-content').innerHTML=outreachAdminView();bindOutreachAdminUI()}
 catch{
  $('admin-content').innerHTML='<section class="panel"><h2>Admin view unavailable</h2><p role="alert">The admin view could not be displayed. Reload the page to try again. No action will be retried automatically.</p><button id="admin-reload" type="button">Reload admin page</button></section>';
  $('admin-reload').onclick=()=>location.reload();
 }
}
render();
