#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

fs.rmSync(path.join(process.cwd(), "dist"), { recursive: true, force: true });
