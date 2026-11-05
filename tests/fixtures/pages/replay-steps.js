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
          // A page that loads on the Courses tab, from the saved preference of the student.
          if (params.get('fixture_tab') === 'courses') {
            const courses = target.querySelector('.fixture-widget-tabs [role="tab"]:not([aria-selected])');
            if (courses && window.fixtureSelectTab) window.fixtureSelectTab(courses);
          }
          // The People widget with the markup of the package: the real rows, the two filters and
          // the pager. Without the flag the page holds the plain placeholder.
          const people = document.getElementById('fixture-people-widget');
          const slot = target.querySelector('[data-testid="widget-container-people-widget"]');
          if (params.has('fixture_people') && people && slot) slot.innerHTML = people.innerHTML;
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
    // The extension records what each inline property held before it set it: React draws the
    // node again with those values only.
    const record = element.getAttribute('data-weekrow-styled');
    if (record !== null) {
      for (const [name, [value, priority]] of Object.entries(JSON.parse(record))) {
        if (value === '') element.style.removeProperty(name);
        else element.style.setProperty(name, value, priority);
      }
      if (element.getAttribute('style') === '') element.removeAttribute('style');
    }
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-weekrow-') || name.startsWith('data-wr-')) element.removeAttribute(name);
    }
  }
  return copy;
};

// Selects a tab as InstUI Tabs does: the selected tab has aria-selected="true", and the other tab
// has no such attribute. The panel of the tab that is not selected is not rendered.
window.fixtureSelectTab = function (tab) {
  const title = tab.querySelector('[data-testid^="tab-"]');
  const panel = document.querySelector('[data-testid="dashboard-tab-content"]');
  if (!title || !panel) return;
  if (window.fixtureDashboardHTML === undefined) {
    const copy = window.fixtureFreshClone(panel);
    window.fixtureDashboardHTML = copy.innerHTML;
  }
  panel.innerHTML = title.dataset.testid === 'tab-courses'
    ? document.getElementById('fixture-courses-panel').innerHTML
    : window.fixtureDashboardHTML;
  for (const item of document.querySelectorAll('.fixture-widget-tabs [role="tab"]')) {
    if (item === tab) item.setAttribute('aria-selected', 'true');
    else item.removeAttribute('aria-selected');
  }
};

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.fixture-widget-tabs [role="tab"]');
  if (tab) window.fixtureSelectTab(tab);
});
