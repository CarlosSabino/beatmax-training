@echo off
setlocal
cd /d "%~dp0"

rem O Windows costuma ter um "python.exe" falso no PATH por padrao (App Execution Alias),
rem que so existe pra empurrar voce pra Microsoft Store e NAO e Python de verdade -- por
rem isso a checagem tem que efetivamente RODAR o comando (--version) e ver se funciona,
rem em vez de so checar se existe alguma coisa com esse nome no PATH (where).

py -3 --version >nul 2>nul
if errorlevel 1 goto trypython
set "PYCMD=py -3"
goto gotpython

:trypython
python --version >nul 2>nul
if errorlevel 1 goto trypython3
set "PYCMD=python"
goto gotpython

:trypython3
python3 --version >nul 2>nul
if errorlevel 1 goto nopython
set "PYCMD=python3"
goto gotpython

:nopython
echo.
echo Nao encontrei o Python instalado nesse PC (de verdade -- o Windows as vezes tem um
echo "python" falso no PATH que so abre a Microsoft Store, esse aqui nao serve).
echo.
echo Ele so e usado pra servir os arquivos do jogo localmente -- nada vai pra internet.
echo.
echo Vou abrir a pagina de download. Baixa a versao normal (nao a da Microsoft Store) e,
echo na instalacao, MARCA a caixinha "Add python.exe to PATH" antes de clicar em Install.
echo Depois, roda esse arquivo de novo.
echo.
start https://www.python.org/downloads/
pause
exit /b 1

:gotpython
rem Se o servidor ja estiver ligado (ex.: inicio automatico com o Windows), o servidor.py so
rem abre o jogo no navegador e sai -- esta janela fecha sozinha.
if not exist servidor.py goto semservidor
set "DJMAX_SUPERVISED=1"
set "ABRIR=--abrir"
echo.
echo Iniciando servidor local em http://localhost:8791 ...
echo Deixe ESTA JANELA ABERTA enquanto estiver jogando (ou use o
echo instalar-inicio-automatico.bat pra ele ligar escondido junto com o Windows).
echo Atualizar: e so copiar os arquivos novos por cima -- o servidor se reinicia sozinho
echo quando o servidor.py muda, e o resto basta um F5 na pagina.
echo Pra parar o servidor, fecha esta janela ou aperta Ctrl+C.
echo.

:loop
%PYCMD% servidor.py 8791 %ABRIR%
set "RC=%errorlevel%"
set "ABRIR="
if "%RC%"=="3" (
    echo.
    echo servidor.py atualizado -- reiniciando...
    goto loop
)
if "%RC%"=="0" exit /b 0

echo.
echo O servidor parou (codigo %RC%).
echo Se foi sem querer (ex: porta 8791 ja em uso por outro programa), fecha as outras
echo janelas do servidor e roda esse arquivo de novo.
pause
exit /b %RC%

:semservidor
start http://localhost:8791/index.html
%PYCMD% -m http.server 8791
pause
