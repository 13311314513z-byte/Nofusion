# Git commit and push script
Set-Location "c:\Users\white\Downloads\Nofusion-main"
git add .gitignore
git add reports/
git commit -m "feat: track reports directory with assessment documents"
git push gitee master
git push origin master
Write-Output "DONE"
