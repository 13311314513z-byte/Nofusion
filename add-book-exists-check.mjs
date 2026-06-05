import fs from "node:fs";

const filePath = "packages/studio/src/api/server.ts";
let content = fs.readFileSync(filePath, "utf-8");

const targets = [
  { signature: 'app.put("/api/v1/books/:id/truth/:file{.+}"', label: 'PUT truth/:file' },
  { signature: 'app.post("/api/v1/books/:id/roles"', label: 'POST roles' },
  { signature: 'app.put("/api/v1/books/:id/roles/:roleId"', label: 'PUT roles/:roleId' },
  { signature: 'app.delete("/api/v1/books/:id/roles/:roleId"', label: 'DELETE roles/:roleId' },
  { signature: 'app.get("/api/v1/books/:id/chapter-goals"', label: 'GET chapter-goals' },
  { signature: 'app.put("/api/v1/books/:id/chapter-goals/:chapterNumber"', label: 'PUT chapter-goals' },
  { signature: 'app.delete("/api/v1/books/:id/chapter-goals/:chapterNumber"', label: 'DELETE chapter-goals' },
  { signature: 'app.get("/api/v1/books/:id/fanfic"', label: 'GET fanfic' },
  { signature: 'app.get("/api/v1/books/:id/roles"', label: 'GET roles' },
  { signature: 'app.get("/api/v1/books/:id/roles/:roleId"', label: 'GET roles/:roleId' },
  { signature: 'app.get("/api/v1/books/:id/detect/stats"', label: 'GET detect/stats' },
  { signature: 'app.post("/api/v1/books/:id/detect/:chapter"', label: 'POST detect/:chapter' },
  { signature: 'app.post("/api/v1/books/:id/detect-all"', label: 'POST detect-all' },
  { signature: 'app.post("/api/v1/books/:id/rewrite/:chapter"', label: 'POST rewrite/:chapter' },
  { signature: 'app.post("/api/v1/books/:id/resync/:chapter"', label: 'POST resync/:chapter' },
  { signature: 'app.post("/api/v1/books/:id/write-next"', label: 'POST write-next' },
  { signature: 'app.post("/api/v1/books/:id/draft"', label: 'POST draft' },
  { signature: 'app.post("/api/v1/books/:id/chapters/:num/approve"', label: 'POST approve' },
  { signature: 'app.post("/api/v1/books/:id/chapters/:num/reject"', label: 'POST reject' },
  { signature: 'app.get("/api/v1/books/:id/truth"', label: 'GET truth' },
];

const idLine = '    const id = c.req.param("id");';
const checkLine = '    await assertBookExists(state, id);';

let modified = 0;
let skipped = 0;

for (const target of targets) {
  const idx = content.indexOf(target.signature);
  if (idx === -1) {
    console.error(`NOT FOUND: ${target.label}`);
    continue;
  }

  // Find the id line within the next 5 lines after the signature
  const afterSignature = content.slice(idx);
  const idIdx = afterSignature.indexOf(idLine);
  if (idIdx === -1 || idIdx > 400) {
    console.error(`NO ID LINE: ${target.label}`);
    continue;
  }

  const absoluteIdIdx = idx + idIdx;
  const afterId = content.slice(absoluteIdIdx + idLine.length);

  // Check if assertBookExists is already present after this id line
  const nextLineEnd = afterId.indexOf('\n');
  const nextLine = nextLineEnd !== -1 ? afterId.slice(0, nextLineEnd).trim() : '';

  if (nextLine.includes('assertBookExists')) {
    console.log(`SKIP (already has check): ${target.label}`);
    skipped++;
    continue;
  }

  // Insert check line after id line
  const before = content.slice(0, absoluteIdIdx + idLine.length);
  const after = content.slice(absoluteIdIdx + idLine.length);
  content = before + '\n' + checkLine + after;
  modified++;
  console.log(`MODIFIED: ${target.label}`);
}

fs.writeFileSync(filePath, content, "utf-8");
console.log(`\nDone: ${modified} modified, ${skipped} skipped`);
