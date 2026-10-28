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
rem Liga o servidor escondido (sem janela) junto com o Windows e cria o atalho
rem "BEATMAX Training" na Area de Trabalho. Nao precisa de administrador.
echo.
%PYCMD% servidor.py 8791 --instalar-inicio
echo.
echo Pronto! Daqui pra frente e so abrir o atalho "BEATMAX Training" da Area de Trabalho
echo (ou http://localhost:8791). Pra atualizar o jogo, copie os arquivos novos por cima:
echo o servidor se reinicia sozinho. Pra desfazer: remover-inicio-automatico.bat
echo Se mudar esta pasta de lugar, rode este arquivo de novo.
echo.
pause
