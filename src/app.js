const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Health check — Cloud Run requires this
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Routes
app.use('/fan', require('./routes/fan'));
app.use('/staff', require('./routes/staff'));
app.use('/station', require('./routes/station'));
app.use('/t', require('./routes/tap')); // fan tap view

app.use((err, req, res, next) => {
  console.error('unhandled error:', err)
  res.status(500).json({ error: 'server error' })
});


module.exports = app;