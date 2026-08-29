class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

class NotFoundError extends AppError {
  constructor(msg = 'Not found') {
    super(msg, 404);
  }
}

class ConflictError extends AppError {
  constructor(msg = 'Conflict') {
    super(msg, 409);
  }
}

class ValidationError extends AppError {
  constructor(details) {
    super('Validation failed', 400);
    this.details = details;
  }
}

module.exports = { AppError, NotFoundError, ConflictError, ValidationError };
