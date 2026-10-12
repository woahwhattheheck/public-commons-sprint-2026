/* Progressive enhancements; native navigation, search and content remain usable without this script. */
(() => {
  'use strict';
  const words = Object.assign({
    compare: 'Compare images', originals: 'Show both original images',
    position: 'Image comparison position', before: 'Before', after: 'After',
    comparison: 'Before and after image comparison',
    percentBefore: '% of the before image is visible', scrollTable: 'Scrollable data table',
  }, window.csktDewrText || {});
  const nav = document.getElementById('primary-navigation');
  const toggle = document.querySelector('.dewr-menu-toggle');
  if (nav && toggle) {
    const compact = window.matchMedia('(max-width: 60rem)');
    let expanded = !compact.matches;
    const renderMenu = () => {
      toggle.hidden = !compact.matches;
      nav.hidden = compact.matches && !expanded;
      toggle.setAttribute('aria-expanded', String(!nav.hidden));
    };
    toggle.addEventListener('click', () => { expanded = !expanded; renderMenu(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && compact.matches && expanded) {
        expanded = false; renderMenu(); toggle.focus();
      }
    });
    compact.addEventListener('change', () => { expanded = !compact.matches; renderMenu(); });
    renderMenu();
  }
  document.querySelectorAll('[data-dewr-print]').forEach(button => {
    button.hidden = false;
    button.addEventListener('click', () => window.print());
  });
  document.querySelectorAll('.dewr-entry-content table').forEach((table, index) => {
    if (table.closest('.dewr-table-scroll')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'dewr-table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    const caption = table.querySelector('caption');
    if (caption && caption.textContent.trim()) {
      if (!caption.id) caption.id = 'dewr-table-caption-' + (index + 1);
      wrapper.setAttribute('aria-labelledby', caption.id);
    } else {
      wrapper.setAttribute('aria-label', words.scrollTable);
    }
    table.before(wrapper); wrapper.append(table);
  });
  const readImage = image => image.complete
    ? Promise.resolve(Boolean(image.naturalWidth && image.naturalHeight))
    : new Promise(resolve => {
      image.addEventListener('load', () => resolve(true), {once: true});
      image.addEventListener('error', () => resolve(false), {once: true});
    });
  document.querySelectorAll('.dewr-image-comparison').forEach(async (group, index) => {
    const figures = [...group.querySelectorAll('figure.wp-block-image')].filter(figure =>
      figure.closest('.dewr-image-comparison') === group
    );
    if (figures.length !== 2 || group.dataset.dewrEnhanced) return;
    const images = figures.map(figure => figure.querySelector('img'));
    if (images.some(image => !image)) return;
    const loaded = await Promise.all(images.map(readImage));
    if (loaded.some(ok => !ok)) return;
    const ratios = images.map(image => image.naturalWidth / image.naturalHeight);
    // Preserve unmatched images as the two native originals; a slider must not distort source imagery.
    if (Math.abs(ratios[0] / ratios[1] - 1) > .01) return;
    group.dataset.dewrEnhanced = 'true';
    const stage = document.createElement('div');
    stage.className = 'dewr-comparison-stage';
    stage.setAttribute('aria-hidden', 'true');
    const clone = image => {
      const copy = image.cloneNode(false);
      copy.removeAttribute('id'); copy.removeAttribute('aria-describedby');
      copy.alt = ''; copy.loading = 'eager'; copy.decoding = 'async';
      return copy;
    };
    stage.append(clone(images[1]));
    const beforeLayer = document.createElement('div');
    beforeLayer.className = 'dewr-comparison-before';
    beforeLayer.append(clone(images[0]));
    stage.append(beforeLayer);
    const divider = document.createElement('div');
    divider.className = 'dewr-comparison-divider';
    stage.append(divider);
    for (const side of ['before', 'after']) {
      const label = document.createElement('span');
      label.className = 'dewr-comparison-label dewr-comparison-label-' + side;
      label.textContent = words[side]; stage.append(label);
    }
    const controls = document.createElement('div');
    controls.className = 'dewr-comparison-controls';
    const label = document.createElement('label');
    const slider = document.createElement('input');
    const originals = document.createElement('div');
    originals.className = 'dewr-comparison-originals';
    originals.id = 'dewr-comparison-originals-' + (index + 1);
    slider.id = 'dewr-comparison-slider-' + (index + 1);
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.value = '50';
    label.htmlFor = slider.id; label.textContent = words.position;
    const originalButton = document.createElement('button');
    originalButton.type = 'button'; originalButton.textContent = words.originals;
    originalButton.setAttribute('aria-controls', originals.id);
    originalButton.setAttribute('aria-expanded', 'false');
    originals.hidden = true;
    const describe = () => {
      stage.style.setProperty('--dewr-comparison-position', slider.value + '%');
      slider.setAttribute('aria-valuetext', slider.value + words.percentBefore);
    };
    slider.addEventListener('input', describe); describe();
    originalButton.addEventListener('click', () => {
      originals.hidden = !originals.hidden;
      originalButton.setAttribute('aria-expanded', String(!originals.hidden));
    });
    controls.append(label, slider, originalButton);
    const firstFigure = figures[0];
    firstFigure.before(stage, controls, originals);
    for (const figure of figures) originals.append(figure);
    // The original image descriptions remain available to the slider without duplicating visual images.
    const descriptions = images.map(image => image.alt.trim()).filter(Boolean);
    if (descriptions.length) {
      const description = document.createElement('p');
      description.id = 'dewr-comparison-description-' + (index + 1);
      description.className = 'screen-reader-text';
      description.textContent = words.before + ': ' + (images[0].alt || '') + '. ' + words.after + ': ' + (images[1].alt || '') + '.';
      controls.prepend(description);
      slider.setAttribute('aria-describedby', description.id);
    }
  });
})();
