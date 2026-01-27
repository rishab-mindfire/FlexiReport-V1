const express = require('express');
const path = require('path');
const app = express();

const PORT = 8000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  //res.sendFile(path.join(__dirname, 'erdGraph', 'index.html'));
  res.sendFile(path.join(__dirname, 'layout', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
