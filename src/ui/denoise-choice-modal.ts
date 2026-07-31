import { Modal, Setting, type App } from 'obsidian'

export type DenoiseMethod = 'nlm35' | 'flux'

export interface DenoiseChoiceModalOptions {
	fluxAvailable: boolean
	fluxProviderName?: string
	onChoose: (method: DenoiseMethod) => void
}

export class DenoiseChoiceModal extends Modal {
	private method: DenoiseMethod = 'nlm35'

	constructor(app: App, private readonly options: DenoiseChoiceModalOptions) {
		super(app)
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this
		modalEl.classList.add('bragi-modal', 'bragi-denoise-choice-modal')
		titleEl.setText('Denoise image')

		const methodSetting = new Setting(contentEl)
			.setName('Method')
			.setDesc('Local CPU denoise does not redraw or resize the image.')

		methodSetting.addDropdown(dropdown => {
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- NLM and CPU are standard initialisms.
			const nlmLabel = 'NLM 35 - Local CPU'
			dropdown
				.addOption('nlm35', nlmLabel)
				.addOption(
					'flux',
					this.options.fluxAvailable
						? `FLUX.2 Klein 9B - ${this.options.fluxProviderName || 'AI refine'}`
						: 'FLUX.2 Klein 9B - Not configured',
				)
				.setValue(this.method)
				.onChange(value => {
					this.method = value as DenoiseMethod
					methodSetting.setDesc(this.method === 'nlm35'
						? 'Local CPU denoise does not redraw or resize the image.'
						: 'AI refine can redraw details and applies upstream color matching when connected.')
				})

			const fluxOption = Array.from(dropdown.selectEl.options).find(option => option.value === 'flux')
			if (fluxOption) fluxOption.disabled = !this.options.fluxAvailable
		})

		if (!this.options.fluxAvailable) {
			contentEl.createEl('p', {
				text: 'Configure FLUX.2 Klein 9B with BFL, RunPod, or fal.ai in Settings to enable AI refine.',
				cls: 'setting-item-description',
			})
		}

		const buttonRow = contentEl.createDiv({ cls: 'modal-button-container' })
		const cancelButton = buttonRow.createEl('button', { text: 'Cancel' })
		cancelButton.addEventListener('click', () => this.close())

		const runButton = buttonRow.createEl('button', { text: 'Run denoise', cls: 'mod-cta' })
		runButton.addEventListener('click', () => {
			const method = this.method
			this.close()
			this.options.onChoose(method)
		})
	}

	onClose(): void {
		this.contentEl.empty()
	}
}
