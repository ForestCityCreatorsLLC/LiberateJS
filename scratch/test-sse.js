const http = require('http');

const req = http.get('http://localhost:4444/api/convert?projectId=proj-1&repoName=standalone-ecommerce-store', (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(chunk);
  });
  res.on('end', () => {
    console.log('Stream ended');
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
  process.exit(1);
});
