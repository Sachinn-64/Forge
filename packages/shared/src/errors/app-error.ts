export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(msg: string, code = "BAD_REQUEST") {
    return new AppError(400, code, msg);
  }
  static unauthorized(msg = "Unauthorized") {
    return new AppError(401, "UNAUTHORIZED", msg);
  }
  static forbidden(msg = "Forbidden") {
    return new AppError(403, "FORBIDDEN", msg);
  }
  static notFound(msg = "Not found") {
    return new AppError(404, "NOT_FOUND", msg);
  }
  static conflict(msg: string, code = "CONFLICT") {
    return new AppError(409, code, msg);
  }
}
