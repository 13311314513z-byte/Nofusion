# Batch chapter generation for Stage 1 baseline data collection
# Usage: .\scripts\batch-generate.ps1
# Generates chapters across all books to build a sample set for evaluation

$ErrorActionPreference = "Continue"
$startTime = Get-Date

# Configuration
$repoRoot = Split-Path -Parent $PSScriptRoot
$cliDir = Join-Path $repoRoot "packages\cli"
$logDir = Join-Path $repoRoot "reports\generation-logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not $env:INKOS_LLM_API_KEY) {
    throw "INKOS_LLM_API_KEY must be set in the environment."
}

function Generate-Chapters {
    param (
        [string]$BookId,
        [int]$Count,
        [string]$Context,
        [string]$LogFile
    )

    Write-Host "=== Generating $Count chapters for '$BookId' ===" -ForegroundColor Cyan
    $chapterStart = Get-Date

    Set-Location $cliDir
    $result = & node dist/index.js write next $BookId --count $Count --json --quiet --context $Context 2>&1
    $exitCode = $LASTEXITCODE

    $result | Out-File -FilePath $LogFile -Encoding utf8
    if ($exitCode -ne 0) {
        Write-Host "  Generation failed with exit code $exitCode. See $LogFile" -ForegroundColor Red
        return
    }

    $elapsed = (Get-Date) - $chapterStart
    Write-Host "  Completed in $($elapsed.TotalMinutes.ToString('F1')) minutes" -ForegroundColor Green

    # Extract chapter info from JSON output
    try {
        $resultText = $result -join [Environment]::NewLine
        $jsonStart = $resultText.IndexOf('[')
        if ($jsonStart -ge 0) {
            $jsonPart = $resultText.Substring($jsonStart)
            $chapters = $jsonPart | ConvertFrom-Json
            foreach ($ch in $chapters) {
                Write-Host "  Chapter $($ch.chapterNumber): '$($ch.title)' - $($ch.wordCount) chars - Audit: $($ch.auditResult.passed)" -ForegroundColor Yellow
                Write-Host "  Token usage: $($ch.tokenUsage.totalTokens) total" -ForegroundColor Gray
            }
        }
    } catch {
        Write-Host "  (Could not parse JSON output)" -ForegroundColor Red
    }
}

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  INKOS BATCH CHAPTER GENERATION" -ForegroundColor Magenta
Write-Host "  Started: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

# === Book 1: test-book-0609 (cozy, has 7 chapters, generate 3 more) ===
Generate-Chapters -BookId "test-book-0609" `
    -Count 3 `
    -Context "Continue the mystery story. Advance the plot naturally while maintaining character consistency. Each chapter should have a clear narrative purpose." `
    -LogFile "$logDir\test-book-0609-ch8-10.json"

# === Book 2: 药 (historical, has 1 chapter, generate 4 more) ===
Generate-Chapters -BookId "药" `
    -Count 4 `
    -Context "Continue the historical story. Advance the plot naturally. Each chapter should develop the setting and characters." `
    -LogFile "$logDir\药-ch2-5.json"

# === Book 3: 通兰民间故事集 (general, has 2 chapters, generate 3 more) ===
Generate-Chapters -BookId "通兰民间故事集" `
    -Count 3 `
    -Context "Continue the folk story collection. Each chapter should be a self-contained narrative that advances the overall arc." `
    -LogFile "$logDir\通兰民间故事集-ch3-5.json"

$totalElapsed = (Get-Date) - $startTime
Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  BATCH GENERATION COMPLETE" -ForegroundColor Magenta
Write-Host "  Total time: $($totalElapsed.TotalHours.ToString('F1')) hours" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

Write-Host ""
Write-Host "Chapter summary:" -ForegroundColor Cyan

$books = @("test-book-0609", "药", "通兰民间故事集")
foreach ($book in $books) {
    $chapters = Get-ChildItem (Join-Path $repoRoot "books\$book\chapters\*.md") -ErrorAction SilentlyContinue
    Write-Host "  $book : $($chapters.Count) chapters" -ForegroundColor Yellow
}
