.PHONY: help release patch minor major publish check clean

VERSION := $(shell node -p "require('./package.json').version")
NAME    := $(shell node -p "require('./package.json').name")

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

check: ## Pre-flight checks before releasing
	@echo "📦 $(NAME)@$(VERSION)"
	@echo ""
	@echo "Checking git status..."
	@test -z "$$(git status --porcelain)" || (echo "❌ Working tree is dirty" && exit 1)
	@echo "✅ Working tree clean"
	@echo "Checking on main branch..."
	@test "$$(git branch --show-current)" = "main" || (echo "❌ Not on main branch" && exit 1)
	@echo "✅ On main branch"
	@echo "Checking remote is up to date..."
	@git fetch origin --quiet
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || (echo "❌ Local and remote are out of sync" && exit 1)
	@echo "✅ In sync with origin/main"
	@echo ""
	@echo "Ready to release ✨"

patch: ## Bump patch version (1.0.1 → 1.0.2)
	npm version patch

minor: ## Bump minor version (1.0.1 → 1.1.0)
	npm version minor

major: ## Bump major version (1.0.1 → 2.0.0)
	npm version major

publish: check ## Publish to npm (runs checks first)
	@echo "Publishing $(NAME)@$(VERSION) to npm..."
	npm publish --access public
	@echo ""
	@echo "Pushing tags to origin..."
	git push origin main --tags
	@echo ""
	@echo "🚀 Published $(NAME)@$(VERSION)"

release-patch: check patch publish ## Check, bump patch, publish
release-minor: check minor publish ## Check, bump minor, publish
release-major: check major publish ## Check, bump major, publish

clean: ## Remove node_modules
	rm -rf node_modules
