const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.parentNode = null;
    this.classList = {
      add() {},
      remove() {},
    };
  }

  get firstChild() {
    return this.children[0] || null;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.children.indexOf(reference);
    child.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const [id, nestedSelector] = selector.slice(1).split(/\s+/, 2);
      const element = findById(this, id);
      return nestedSelector ? element?.querySelector(nestedSelector) || null : element;
    }
    return findFirst(this, selector);
  }

  querySelectorAll(selector) {
    return findAll(this, selector);
  }

  getBoundingClientRect() {
    return { width: 800, height: 600 };
  }
}

function findById(root, id) {
  if (root.attributes.id === id) return root;
  for (const child of root.children) {
    const match = findById(child, id);
    if (match) return match;
  }
  return null;
}

function findFirst(root, tagName) {
  for (const child of root.children) {
    if (child.tagName === tagName) return child;
    const nested = findFirst(child, tagName);
    if (nested) return nested;
  }
  return null;
}

function findAll(root, tagName) {
  const matches = [];
  for (const child of root.children) {
    if (child.tagName === tagName) matches.push(child);
    matches.push(...findAll(child, tagName));
  }
  return matches;
}

function createDemoDom() {
  const elements = new Map([
    ['canvas', new FakeElement('svg')],
    ['addNodeBtn', new FakeElement('button')],
    ['connectMode', new FakeElement('input')],
    ['clearBtn', new FakeElement('button')],
    ['resetInputsBtn', new FakeElement('button')],
  ]);
  const rule = {
    checked: true,
    value: 'OR',
    addEventListener() {},
  };
  return {
    svg: elements.get('canvas'),
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      getElementsByName(name) {
        return name === 'rule' ? [rule] : [];
      },
      createElementNS(_namespace, tagName) {
        return new FakeElement(tagName);
      },
    },
    window: {
      addEventListener() {},
    },
  };
}

function edgeSnapshot(svg) {
  const edgeLayer = svg.children.find(element => element.tagName === 'g');
  assert.ok(edgeLayer, 'edge layer should exist');
  return edgeLayer.children.map(line => {
    const markerMatch = /^url\(#(.+)\)$/.exec(line.attributes['marker-end'] || '');
    assert.ok(markerMatch, 'each edge should reference an SVG marker');
    const marker = svg.querySelector(`#${markerMatch[1]}`);
    const markerPath = marker?.querySelector('path');
    assert.ok(markerPath, 'each edge marker should contain a path');
    return {
      lineColor: line.attributes.stroke,
      markerId: markerMatch[1],
      markerColor: markerPath.attributes.fill,
    };
  });
}

test('each arrowhead keeps the color of its own source edge', () => {
  const { svg, document, window } = createDemoDom();
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  vm.runInNewContext(source, { document, window });

  const nodeLayer = svg.children.find((element, index) =>
    element.tagName === 'g' && index === 3
  );
  assert.ok(nodeLayer, 'node layer should exist');

  const [activeInput, inactiveInput] = nodeLayer.children;
  const initial = edgeSnapshot(svg);
  assert.equal(initial.length, 2);
  assert.notEqual(initial[0].markerId, initial[1].markerId);
  assert.deepEqual(initial.map(edge => edge.lineColor), ['#f1c40f', '#111']);
  assert.deepEqual(initial.map(edge => edge.markerColor), ['#f1c40f', '#111']);

  activeInput.listeners.click({ stopPropagation() {} });
  const bothInactive = edgeSnapshot(svg);
  assert.deepEqual(bothInactive.map(edge => edge.lineColor), ['#111', '#111']);
  assert.deepEqual(bothInactive.map(edge => edge.markerColor), ['#111', '#111']);

  inactiveInput.listeners.click({ stopPropagation() {} });
  const secondActive = edgeSnapshot(svg);
  assert.deepEqual(secondActive.map(edge => edge.lineColor), ['#111', '#f1c40f']);
  assert.deepEqual(secondActive.map(edge => edge.markerColor), ['#111', '#f1c40f']);
});
