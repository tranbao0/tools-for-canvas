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
        if (target) target.innerHTML = step.innerHTML;
        setTimeout(function () { run(index + 1); }, delay);
      }
      function start() { setTimeout(function () { run(0); }, delay); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    })();
