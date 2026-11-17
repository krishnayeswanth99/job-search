// Mimics Jobright's apply flow as recorded on the real site (2026-11):
// 1. Apply / Apply with Autofill: window.open('about:blank') as a pop-up check, closed ~0.3 s later
//    (if the pop-up is blocked, nothing else happens);
// 2. "Customize Your Resume in 10 seconds" Ant Design modal with BUTTONS "Fix My Resume Now" and
//    "Apply without Customizing" (no links);
// 3. "Apply without Customizing": window.open('about:blank') then w.location.href = employer ATS URL;
// 4. "Did you apply ?" modal (Close / Yes, I applied! / No, I didn't apply).
window.__answered = null;
function jrModal(inner) {
  const root = document.createElement('div');
  root.className = 'ant-modal-root css-1cle034';
  root.innerHTML = `<div class="ant-modal-mask"></div><div tabindex="-1" class="ant-modal-wrap ant-modal-centered"><div role="dialog" aria-modal="true" class="ant-modal css-1cle034"><div class="ant-modal-content">${inner}</div></div></div>`;
  document.body.appendChild(root);
  return root;
}
function jrApply(n, hexId) {
  const probe = window.open('about:blank', '_blank');
  if (!probe) return; // pop-up blocked: Jobright silently does nothing
  setTimeout(() => {
    probe.close();
    const m = jrModal(`<div class="ant-modal-body"><div class="index_modalHeader__JH5wp"><div class="index_modalTitle__8ScG0">Customize Your Resume in 10 seconds</div><div class="index_closeBtn__p6Rpv"><img alt="close-icon"></div></div>
      <div class="index_confirm-popup-content__RavXX"><span>Your resume is on the right track, but essential keywords are missing</span>
      <div class="index_confirm-popup-buttons__WYsnJ ant-flex"><button type="button" class="ant-btn ant-btn-primary"><p>Fix My Resume Now</p></button><button type="button" class="ant-btn ant-btn-default index_cancelButton__hvybW"><p>Apply without Customizing</p></button></div></div></div>`);
    m.querySelector('.ant-btn-primary').onclick = () => (window.__fixResume = true);
    m.querySelector('.index_cancelButton__hvybW').onclick = () => {
      m.remove();
      const w = window.open('about:blank', '_blank');
      if (!w) return;
      w.location.href = `https://job-boards.greenhouse.io/embed/job_app?for=kodiak&token=${4511215000 + n}&jr_id=${hexId}`;
      setTimeout(() => {
        const d = jrModal(`<button type="button" aria-label="Close" class="ant-modal-close"><span class="ant-modal-close-x">x</span></button><div class="ant-modal-body"><h2>Did you apply ?</h2><p>Let us know so we can help you track your application!</p>
          <button type="button" class="ant-btn yes"><span>Yes, I applied!</span></button><button type="button" class="ant-btn no"><span>No, I didn't apply</span></button></div>`);
        d.querySelector('.ant-modal-close').onclick = () => d.remove();
        d.querySelector('.yes').onclick = () => { window.__answered = 'yes'; d.remove(); };
        d.querySelector('.no').onclick = () => { window.__answered = 'no'; d.remove(); };
      }, 400);
    };
  }, 300);
}
