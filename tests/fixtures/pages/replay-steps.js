    // Canvas fills parts of the page after load: jQuery replaces the contents of #right-side
    // with the /dashboard-sidebar HTML, and React renders into empty containers. This replays
    // those steps from the template[data-fixture-step] elements, in order, then sets
    // html[data-fixture-ready]. Add ?fixture_delay_ms=0 to the URL to skip the pauses.
    (function () {
      var delay = Number(new URLSearchParams(location.search).get('fixture_delay_ms') || '50');
      var steps = Array.prototype.slice.call(document.querySelectorAll('template[data-fixture-step]'));
      function run(index) {
        if (index >= steps.length) {
          document.documentElement.setAttribute('data-fixture-ready', 'true');
          return;
        }
        var step = steps[index];
        var target = document.querySelector(step.getAttribute('data-target'));
        if (target) {
          target.innerHTML = step.innerHTML;
          const params = new URLSearchParams(location.search);
          const section = target.querySelector('[data-testid="widget-course-work-combined-widget"]');
          if (section) {
            const state = params.get('fixture_course_work');
            if (state === 'none') section.parentElement.remove();
            if (state === 'second') {
              const wrapper = document.createElement('div');
              wrapper.dataset.testid = 'widget-container-course_work-widget-first';
              wrapper.innerHTML = '<section class="fx-section" data-testid="widget-course_work-widget-first"><h2>Course work</h2><p>Could not load Course work</p><button data-testid="course_work-widget-first-retry-button">Retry</button></section>';
              section.parentElement.before(wrapper);
            }
            if (state === 'pair') {
              // A loaded Course work widget stands first, and the combined widget follows it.
              const wrapper = section.parentElement.cloneNode(true);
              wrapper.dataset.testid = 'widget-container-course_work_combined-widget-first';
              wrapper.querySelector('section').dataset.testid = 'widget-course_work_combined-widget-first';
              for (const node of wrapper.querySelectorAll('[id]')) node.removeAttribute('id');
              for (const node of wrapper.querySelectorAll('[aria-labelledby]')) node.removeAttribute('aria-labelledby');
              section.parentElement.before(wrapper);
            }
            if (state === 'loading' || state === 'error' || state === 'delayed') {
              const children = section.innerHTML;
              section.innerHTML = state === 'error'
                ? '<p>Could not load Course work</p><button data-testid="course-work-combined-widget-retry-button">Retry</button>'
                : '<div role="status" style="height:400px">Loading Course work</div>';
              if (state === 'delayed') setTimeout(() => { section.innerHTML = children; }, 1500);
            }
          }
        }
        setTimeout(function () { run(index + 1); }, delay);
      }
      function start() { setTimeout(function () { run(0); }, delay); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    })();

// A clone copies what the extension set on the page. React draws a fresh node without it, so a
// test that acts like a React re-render clones through this.
window.fixtureFreshClone = function (node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('[data-wr-own], #weekrow-inpage').forEach((own) => own.remove());
  for (const element of [copy, ...copy.querySelectorAll('*')]) {
    if (element.hasAttribute('data-weekrow-styled')) element.removeAttribute('style');
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-weekrow-') || name.startsWith('data-wr-')) element.removeAttribute(name);
    }
  }
  return copy;
};

document.addEventListener('click', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (!tab || !tab.dataset.testid?.startsWith('tab-')) return;
  const panel = document.querySelector('[data-testid="dashboard-tab-content"]');
  if (!panel) return;
  if (window.fixtureDashboardHTML === undefined) {
    const copy = window.fixtureFreshClone(panel);
    window.fixtureDashboardHTML = copy.innerHTML;
  }
  panel.innerHTML = tab.dataset.testid === 'tab-courses'
    ? document.getElementById('fixture-courses-panel').innerHTML
    : window.fixtureDashboardHTML;
  for (const item of document.querySelectorAll('.fixture-widget-tabs [role="tab"]')) {
    item.setAttribute('aria-selected', String(item === tab));
  }
});
