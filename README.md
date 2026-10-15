# Final Graduation Task — Jesse Uwodi

Graduation deliverables for the Product Design and Engineering Bootcamp (Dev and Design HQ). The evidence index is in [`SUBMISSION.md`](./SUBMISSION.md).

- **GitHub:** [jay-inventor007](https://github.com/jay-inventor007)
- **Portfolio:** [jesse-uwodi.vercel.app](https://jesse-uwodi.vercel.app/)

## Structure

```text
final-task-jesse-uwodi/
├── SUBMISSION.md            evidence links and status for every part
├── part-1-job-hunting/      positioning, profile strategy, message templates, offer logistics
├── part-3-system-design/    Payday design document and in-memory prototype
└── part-4-rag-project/      retrieval pipeline over the NUC CCMAS Medicine & Dentistry curriculum
```

Part 2 (Rota and Matinee) is being built in its own repositories, linked from `SUBMISSION.md` once they exist.

## Run

```powershell
# Part 3 prototype tests
cd part-3-system-design/prototype
npm install
npm test

# Part 4 retrieval web page (needs VOYAGE_API_KEY in part-4-rag-project/.env)
cd part-4-rag-project
python src/server.py
```
