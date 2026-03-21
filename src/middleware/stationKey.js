module.exports = function stationKeyMiddleware(req, res, next) {
  const key = req.headers['x-station-key'];
  if (!key || key !== process.env.STATION_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid station key' });
  }
  next();
};