' Abre o menu de bancada (escuta.bat) numa janela visivel, na pasta deste arquivo.
' Duplo clique neste arquivo, ou crie um atalho para ele na area de trabalho.
Set sh = CreateObject("WScript.Shell")
pasta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta
sh.Run """" & pasta & "\escuta.bat""", 1, False
