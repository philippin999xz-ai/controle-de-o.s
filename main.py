import os
import json
from typing import List
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from dotenv import load_dotenv
import google.generativeai as genai
import openpyxl

load_dotenv()

app = FastAPI(title="Backend Controle de O.S. - AÇOFORJA")

# Permite requisições do seu Front-end (GitHub Pages e ambientes locais)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configura o Gemini a partir de variável de ambiente (Render / .env)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "SUA_CHAVE_GEMINI_AQUI")
genai.configure(api_key=GEMINI_API_KEY)

MODEL_CONFIG = {
    "response_mime_type": "application/json"
}

model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    generation_config=MODEL_CONFIG
)

PLANILHA_PATH = "Controle_OS_Mestre_Objetivo.xlsx"
NOME_ABA = "OS_Mestre"


def criar_planilha_se_nao_existir():
    """Garante que a planilha mestra e a aba existem com os cabeçalhos padrão."""
    if not os.path.exists(PLANILHA_PATH):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = NOME_ABA
        ws.append([
            "ID OS", "Data Registro", "Cliente", "Equipamento", 
            "Descrição", "Técnico", "Status", "Prioridade", "Custo Orçado"
        ])
        wb.save(PLANILHA_PATH)


@app.get("/")
def health_check():
    return {"status": "Backend AÇOFORJA Ativo", "planilha": PLANILHA_PATH}


@app.post("/api/registrar-os")
async def registrar_os(
    files: List[UploadFile] = File(...),
    observacoes: str = Form(default="")
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhuma foto ou arquivo foi enviado.")

    try:
        # 1. Monta as partes multimodais (aceita 1 ou mais fotos)
        partes_multimodais = []
        for file in files:
            imagem_bytes = await file.read()
            partes_multimodais.append({
                "mime_type": file.content_type or "image/jpeg",
                "data": imagem_bytes
            })

        # 2. Prompt estrito para o Gemini
        prompt = f"""
        Analise a(s) imagem(ns) desta Ordem de Serviço da AÇOFORJA e retorne um JSON no formato exato:
        {{
            "cliente": "Nome do cliente/setor",
            "equipamento": "Nome do equipamento ou peça",
            "descricao": "Descrição do problema ou serviço",
            "tecnico": "Nome do técnico ou Não Informado",
            "status": "Pendente",
            "prioridade": "Alta/Média/Baixa",
            "custo_orcado": 0.00
        }}

        Observações adicionais enviadas pelo usuário: {observacoes}
        """
        partes_multimodais.append(prompt)

        # 3. Chama a API do Gemini de forma assíncrona
        response = await model.generate_content_async(partes_multimodais)
        dados = json.loads(response.text)

        # 4. Garante que o arquivo do Excel exista
        criar_planilha_se_nao_existir()

        # 5. Carrega e insere a nova linha na planilha Mestre
        wb = openpyxl.load_workbook(PLANILHA_PATH)
        if NOME_ABA in wb.sheetnames:
            sheet = wb[NOME_ABA]
        else:
            sheet = wb.create_sheet(NOME_ABA)

        proxima_linha = sheet.max_row + 1
        id_os = 1000 + (proxima_linha - 1)

        sheet.cell(row=proxima_linha, column=1, value=id_os)
        sheet.cell(row=proxima_linha, column=3, value=dados.get("cliente", "Açoforja"))
        sheet.cell(row=proxima_linha, column=4, value=dados.get("equipamento", ""))
        sheet.cell(row=proxima_linha, column=5, value=dados.get("descricao", ""))
        sheet.cell(row=proxima_linha, column=6, value=dados.get("tecnico", ""))
        sheet.cell(row=proxima_linha, column=7, value=dados.get("status", "Pendente"))
        sheet.cell(row=proxima_linha, column=8, value=dados.get("prioridade", "Média"))
        
        # Trata o valor numérico para evitar erros de casting
        try:
            custo = float(dados.get("custo_orcado", 0.0))
        except (ValueError, TypeError):
            custo = 0.0
            
        sheet.cell(row=proxima_linha, column=9, value=custo)

        wb.save(PLANILHA_PATH)

        return {
            "sucesso": True,
            "id_os": id_os,
            "dados": dados
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Erro ao processar O.S. com o Gemini ou gravar no Excel: {str(e)}"
        )


@app.get("/api/download-excel")
def download_excel():
    """Permite baixar a planilha mestra atualizada direto pelo navegador/site."""
    if os.path.exists(PLANILHA_PATH):
        return FileResponse(
            path=PLANILHA_PATH,
            filename="Controle_OS_Mestre_Objetivo.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    raise HTTPException(status_code=404, detail="Planilha mestra ainda não foi gerada.")