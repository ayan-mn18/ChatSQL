export { authenticate, optionalAuth } from './auth';
export { errorHandler, notFoundHandler, AppError, BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, ValidationError } from './errorHandler';
export { 
  validate, 
  registerSchema, 
  loginSchema, 
  verifyEmailSchema, 
  resendOtpSchema, 
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema, 
  paginationSchema, 
  uuidParamSchema,
  testConnectionSchema,
  createConnectionSchema,
  updateConnectionSchema
} from './validator';
export {
  rateLimit,
  globalRateLimit,
  authRateLimit,
  aiRateLimit,
  heavyRateLimit,
  connectionRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  consumeRateLimit,
  type RateLimitType,
} from './rateLimit';
export {
  attachPlanInfo,
  enforceReadOnly,
  checkAITokenLimit,
  checkQueryLimit,
  checkConnectionLimit,
  enforceSelectOnly,
} from './planLimits';
