# PAO Console Dial — Multi-project Makefile
# Orchestrates three PlatformIO firmware projects and one React Native mobile app

.PHONY: help

# Default target
help: ## Show all available targets
	@echo "PAO Console Dial — Build & Deploy"
	@echo "=================================="
	@echo ""
	@grep -E '^\w+.*:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"}; {printf "  %-30s %s\n", $$1, $$2}'
	@echo ""

# ─────────────────────────────────────────────────────────────────────────
# Peripheral (ESP32-S3)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: build-peripheral upload-peripheral monitor-peripheral clean-peripheral

build-peripheral: ## Build peripheral firmware (ESP32-S3)
	cd peripheral && pio run

upload-peripheral: ## Upload peripheral firmware to device
	cd peripheral && pio run -t upload

monitor-peripheral: ## Open serial monitor for peripheral device
	cd peripheral && pio run -t monitor

clean-peripheral: ## Clean peripheral build artifacts
	cd peripheral && pio run -t clean

# ─────────────────────────────────────────────────────────────────────────
# Controller (SAMD21 Feather M0 Express)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: build-controller upload-controller monitor-controller clean-controller

build-controller: ## Build controller firmware (SAMD21)
	cd controller && pio run

upload-controller: ## Upload controller firmware to device
	cd controller && pio run -t upload

monitor-controller: ## Open serial monitor for controller device
	cd controller && pio run -t monitor

clean-controller: ## Clean controller build artifacts
	cd controller && pio run -t clean

# ─────────────────────────────────────────────────────────────────────────
# Charger (SAMD21 Feather M0)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: build-charger upload-charger monitor-charger clean-charger

build-charger: ## Build charger firmware (SAMD21)
	cd charger && pio run

upload-charger: ## Upload charger firmware to device
	cd charger && pio run -t upload

monitor-charger: ## Open serial monitor for charger device
	cd charger && pio run -t monitor

clean-charger: ## Clean charger build artifacts
	cd charger && pio run -t clean

# ─────────────────────────────────────────────────────────────────────────
# Aggregate Firmware Targets
# ─────────────────────────────────────────────────────────────────────────

.PHONY: build clean

build: build-peripheral build-controller build-charger ## Build all three firmware projects

clean: clean-peripheral clean-controller clean-charger ## Clean all firmware projects

# ─────────────────────────────────────────────────────────────────────────
# Mobile (React Native)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: mobile-install mobile-android mobile-ios

mobile-install: ## Install mobile app dependencies (npm install)
	cd mobile && npm install

mobile-android: ## Build and run mobile app on Android
	cd mobile && npx react-native run-android

mobile-ios: ## Build and run mobile app on iOS
	cd mobile && npx react-native run-ios

# ─────────────────────────────────────────────────────────────────────────
# Utility
# ─────────────────────────────────────────────────────────────────────────

.PHONY: version

version: ## Show project version info
	@echo "PAO Console Dial — Multi-project Build System"
	@echo "Firmware sub-projects: peripheral (ESP32-S3), controller (SAMD21), charger (SAMD21)"
	@echo "Mobile app: React Native"
