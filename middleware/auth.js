const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'resilient-sms-secret-key';

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header. Use: Bearer <token>'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    const message = error.name === 'TokenExpiredError'
      ? 'Token expired. Please login again.'
      : 'Invalid token.';

    return res.status(401).json({
      status: 'error',
      code: 'UNAUTHORIZED',
      message
    });
  }
}

module.exports = authMiddleware;
