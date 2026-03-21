const express = require('express');
const app = express();

app.use(express.json());

// Health check — Cloud Run requires this
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Routes
app.use('/fan', require('./routes/fan'));
app.use('/staff', require('./routes/staff'));
app.use('/station', require('./routes/station'));
app.use('/t', require('./routes/tap')); // fan tap view

module.exports = app;