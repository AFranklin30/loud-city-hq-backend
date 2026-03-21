const { admin } = require('../services/firestore');

module.exports = async function staffAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.staff = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
};