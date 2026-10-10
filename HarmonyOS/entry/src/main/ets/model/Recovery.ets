export class Recovery {
  url: string = '';
  method: string = 'GET';
  generation: number = 0;
  attempts: number = 0;
  committed: boolean = false;
  failed: boolean = false;
  begin(url: string, retry: boolean): void {
    this.url = url;
    this.generation++;
    this.committed = false;
    this.failed = false;
    if (!retry) this.attempts = 0;
  }
  failure(url: string, code: number, mainFrame: boolean): number {
    // ArkWeb ERR_ABORTED is -3. Subresource failures never replace the page.
    if (!mainFrame || url !== this.url || code === -3 || this.failed || this.committed) return -1;
    this.failed = true;
    const temporary = [-7, -21, -100, -101, -102, -105, -106, -109, -118].includes(code);
    if (temporary && ['GET', 'HEAD'].includes(this.method) && this.attempts < 2) {
      return [2000, 5000][this.attempts++];
    }
    return 0;
  }
  visible(url: string): boolean {
    if (url !== this.url || this.failed) return false;
    this.committed = true;
    return true;
  }
}
