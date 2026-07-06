export type LocatorType = 'css' | 'xpath' | 'id' | 'name' | 'data-testid' | 'aria-label';

export class Locator {
  readonly type: LocatorType;
  readonly value: string;

  constructor(type: LocatorType, value: string) {
    this.type = type;
    this.value = value;
  }

  getSelectorKey(): string {
    switch (this.type) {
      case 'id':          return '#' + this.value;
      case 'name':        return `[name='${this.value}']`;
      case 'xpath':       return 'xpath=' + this.value;
      case 'data-testid': return 'data-testid=' + this.value;
      case 'aria-label':  return 'aria-label=' + this.value;
      default:            return this.value;
    }
  }

  toPlaywrightSelector(): string {
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
