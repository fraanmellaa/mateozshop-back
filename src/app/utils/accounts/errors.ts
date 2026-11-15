export class AccountError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;

  constructor(code: string, status: number, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "AccountError";
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}
