export class FakeNode {
  constructor(tagName = 'div') { this.tagName = tagName; this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.textContent = ''; this.className = ''; this.parentNode = null; this.type = ''; this.disabled = false; }
  append(...nodes) { for (const node of nodes) { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node); node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  click() { for (const listener of this.listeners.get('click') || []) listener({ currentTarget: this }); }
  countNodes() { return 1 + this.children.reduce((sum, child) => sum + child.countNodes(), 0); }
}
export class FakeDocument { createElement(tag) { return new FakeNode(tag); } }
