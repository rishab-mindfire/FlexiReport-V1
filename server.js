const express = require('express');
const path = require('path');
const app = express();

const PORT = 8000;

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Serve folders statically
app.use('/erd', express.static(path.join(__dirname, 'ERD-diagram')));
app.use('/report', express.static(path.join(__dirname, 'Report')));
app.use('/pdf', express.static(path.join(__dirname, 'PDF-Download')));
app.use('/demoJSON', express.static(path.join(__dirname, 'demoJSON')));

// Default route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'server.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
