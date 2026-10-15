import {defineConfig, loadEnv} from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),"");
  return{
    plugins:[react()],
    base:"./",
    // Em desenvolvimento, /api/* vai para o backend local (node backend/server.js) ou para o alvo abaixo.
    server:{proxy:{"/api":{target:env.VITE_PROXY_TARGET||"http://localhost:10000",changeOrigin:true}}}
  };
});
