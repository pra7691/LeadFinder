import { Router } from "express";
import { saveExportFile } from "../services/export-files";

const router = Router();

router.post("/exports/save", async (req, res) => {
  const filename = typeof req.body?.filename === "string" ? req.body.filename : "";
  const content = typeof req.body?.content === "string" ? req.body.content : "";

  if (!filename.trim()) {
    res.status(400).json({ error: "Filename is required" });
    return;
  }

  const saved = await saveExportFile(filename, content);
  res.json({ saved: true, ...saved });
});

export default router;
