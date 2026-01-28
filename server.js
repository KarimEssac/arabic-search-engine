const express = require('express');
const { SERVER_CONFIG } = require('./config/config');
const { initializeSearchMetadata } = require('./core/searchMetadata');
const routes = require('./routes/routes');

const app = express();
const port = SERVER_CONFIG.port;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/', routes);

app.listen(port, async () => {
  console.log(`Server running at http://localhost:${port}`);
  await initializeSearchMetadata();
});