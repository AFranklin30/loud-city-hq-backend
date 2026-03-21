const router = require('express').Router();

// GET /t/:token
router.get('/:token', async (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

module.exports = router;