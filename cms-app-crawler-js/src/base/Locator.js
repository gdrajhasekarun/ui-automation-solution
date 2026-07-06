'use strict';

class Locator {
  constructor(type, value) {
    this.type = type;
    this.value = value;
    Object.freeze(this);
  }

  getSelectorKey() {
    switch (this.type) {
      case 'id':          return '#' + this.value;
      case 'name':        return `[name='${this.value}']`;
      case 'xpath':       return 'xpath=' + this.value;
      case 'data-testid': return 'data-testid=' + this.value;
      case 'aria-label':  return 'aria-label=' + this.value;
      default:            return this.value;
    }
  }

  toPlaywrightSelector() {
    switch (this.type) {
      case 'id':          return `#${this.value}`;
      case 'name':        return `[name='${this.value}']`;
      case 'xpath':       return `xpath=${this.value}`;
      case 'data-testid': return `[data-testid='${this.value}']`;
      case 'aria-label':  return `[aria-label='${this.value}']`;
      default:            return this.value;
    }
  }
}

module.exports = { Locator };
