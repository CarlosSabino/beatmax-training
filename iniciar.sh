#!/bin/bash
# Equivalente do iniciar.bat pra Mac/Linux. Servir por http://localhost em vez de abrir o
# index.html direto (file://) mantém sempre o mesmo "endereço" pro navegador — e é esse
# endereço que decide onde suas charts salvas (localStorage/IndexedDB) ficam guardadas.
# Abrindo direto como arquivo, uma reinstalação/atualização em outra pasta poderia parecer
# que "perdeu" o chart salvo (na verdade ele fica no endereço antigo). Não manda nada pra
# internet, só serve os arquivos desta pasta no seu próprio computador.
cd "$(dirname "$0")"

PYCMD=""
if command -v python3 >/dev/null 2>&1; then
    PYCMD="python3"
elif command -v python >/dev/null 2>&1; then
    PYCMD="python"
else
    echo ""
    echo "Não encontrei o Python instalado nesse computador."
    echo "Ele só é usado pra servir os arquivos do jogo localmente — nada vai pra internet."
    echo "Instale (geralmente já vem no Mac/Linux, ou https://www.python.org/downloads/) e roda de novo."
    echo ""
    exit 1
fi

echo ""
echo "Iniciando servidor local em http://localhost:8791 ..."
echo "Deixe este terminal aberto enquanto estiver jogando."
echo ""

( sleep 1
  if command -v open >/dev/null 2>&1; then open "http://localhost:8791/index.html"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:8791/index.html"
  fi
) &

if [ -f servidor.py ]; then "$PYCMD" servidor.py 8791; else "$PYCMD" -m http.server 8791; fi
