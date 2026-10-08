import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const app = express();
const PORT = Number(process.env.PORT || 10000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://philippin999xz-ai.github.io";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin(origin, cb) {
    if (!origin || origin === FRONTEND_ORIGIN) return cb(null, true);
    return cb(new Error("Origin não autorizada"));
  },
  credentials: true,
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));
app.use(express.json({limit:"12mb"}));

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {error:{code:"RATE_LIMITED",message:"Muitas requisições. Aguarde um minuto."}}
});
app.use("/api/", limiter);

app.get("/api/health", (_req,res) => {
  res.json({ok:true, service:"controle-os", ai:Boolean(GEMINI_API_KEY)});
});

const InputSchema = z.object({
  model: z.string().trim().min(1).max(80),
  input: z.array(z.object({
    type:z.string().max(40),
    text:z.string().max(12000).optional(),
    data:z.string().max(10_000_000).optional(),
    mime_type:z.string().max(100).optional()
  })).min(1).max(8),
  response_format:z.object({
    type:z.string().max(40),
    mime_type:z.string().max(100),
    schema:z.record(z.string(),z.unknown()).optional()
  }).optional()
}).strict();

app.post("/api/ai", async (req,res,next) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({error:{code:"AI_NOT_CONFIGURED",message:"IA não configurada no servidor."}});
    }
    const parsed=InputSchema.safeParse(req.body);
    if(!parsed.success){
      return res.status(400).json({error:{code:"INVALID_INPUT",message:"Dados da solicitação de IA inválidos."}});
    }

    const upstream=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-goog-api-key":GEMINI_API_KEY
      },
      body:JSON.stringify(parsed.data),
      signal:AbortSignal.timeout(90_000)
    });
    const text=await upstream.text();
    let payload={};
    try{payload=JSON.parse(text)}catch{payload={error:{message:"Resposta inválida do provedor de IA"}}}
    if(!upstream.ok){
      return res.status(upstream.status>=500?502:upstream.status).json({
        error:{code:"AI_PROVIDER_ERROR",message:payload?.error?.message||"Falha no provedor de IA."}
      });
    }
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

app.use((err,_req,res,_next)=>{
  console.error("[api]", err?.message || err);
  if(res.headersSent) return;
  res.status(500).json({error:{code:"INTERNAL_ERROR",message:"Erro interno do servidor."}});
});

app.listen(PORT,()=>console.log(`controle-os backend listening on ${PORT}`));
