# Le a serial da PLC32, mostra na tela e grava um log com horario.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File monitor_serial.ps1 -Porta COM6 [-Segundos 0]
#   -Segundos 0 = ate apertar Ctrl+C
param(
  [string]$Porta = "",
  [int]$Segundos = 0
)

# Descobre a porta da PLC32 (conversor CH340) se nao foi informada
if (-not $Porta) {
  # So portas que existem AGORA (o Windows guarda portas antigas de dispositivos desconectados)
  $existentes = [System.IO.Ports.SerialPort]::GetPortNames()
  $achadas = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'CH340|CP210' -and $_.Status -eq 'OK' } |
    ForEach-Object { if ($_.Name -match '\((COM\d+)\)') { $Matches[1] } } | Where-Object { $existentes -contains $_ }
  if (-not $achadas) { Write-Host "PLC32 nao esta conectada pela USB (nenhuma porta CH340/CP210 ativa). Verifique o cabo e a alimentacao."; exit 2 }
  $Porta = @($achadas)[0]
  Write-Host "Porta detectada: $Porta"
}

$pasta = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force $pasta | Out-Null
$arquivo = Join-Path $pasta ("serial_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".txt")

$sp = New-Object System.IO.Ports.SerialPort $Porta, 115200, 'None', 8, 'One'
$sp.DtrEnable = $false   # nao reinicia a placa ao abrir (conversor CH340)
$sp.RtsEnable = $false
$sp.ReadTimeout = 500
try { $sp.Open() } catch { Write-Host "Nao consegui abrir ${Porta}: $($_.Exception.Message)";Write-Host "Feche o monitor do VS Code/PlatformIO, que usam a mesma porta."; exit 3 }

Write-Host "Monitorando $Porta a 115200. Log: $arquivo"
Write-Host "Ctrl+C para sair."
$inicio = Get-Date
try {
  while ($true) {
    if ($Segundos -gt 0 -and ((Get-Date) - $inicio).TotalSeconds -ge $Segundos) { break }
    try { $txt = $sp.ReadExisting() } catch { $txt = "" }
    if ($txt) {
      $stamp = Get-Date -Format "HH:mm:ss"
      foreach ($linha in ($txt -split "`r?`n")) {
        if ($linha.Trim()) {
          $l = "$stamp  $linha"
          Write-Host $l
          Add-Content -Path $arquivo -Value $l -Encoding UTF8
        }
      }
    }
    Start-Sleep -Milliseconds 100
  }
} finally {
  $sp.Close()
  Write-Host "`nLog salvo em: $arquivo"
}
