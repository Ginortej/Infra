package ai

// CatalogModel — карточка модели в маркете.
type CatalogModel struct {
	ID        string    `json:"id"` // имя в библиотеке Ollama: qwen3
	Title     string    `json:"title"`
	Publisher string    `json:"publisher"`
	Desc      string    `json:"desc"`
	Caps      []string  `json:"caps"` // tools, code, vision, thinking, embed, ru
	Variants  []Variant `json:"variants"`
	Pick      string    `json:"pick"` // вариант по умолчанию
}

// Variant — размер модели. Size — объём скачивания в ГБ (квантование Q4 по умолчанию).
type Variant struct {
	Tag  string  `json:"tag"`
	Size float64 `json:"size"`
}

func v(tag string, size float64) Variant { return Variant{tag, size} }

// Catalog — подборка моделей Ollama. Любую другую можно скачать по имени.
func Catalog() []CatalogModel {
	return []CatalogModel{
		{ID: "qwen3", Title: "Qwen3", Publisher: "Alibaba", Pick: "8b",
			Desc: "Универсальная модель с режимом рассуждений. Хорошо вызывает инструменты и понимает русский — лучший выбор для агента.",
			Caps: []string{"tools", "thinking", "ru"}, Variants: []Variant{v("1.7b", 1.4), v("4b", 2.5), v("8b", 5.2), v("14b", 9.3), v("30b", 19), v("32b", 20)}},
		{ID: "gpt-oss", Title: "gpt-oss", Publisher: "OpenAI", Pick: "20b",
			Desc: "Открытая модель OpenAI с рассуждениями и инструментами. Нужна видеокарта от 16 ГБ.",
			Caps: []string{"tools", "thinking", "ru"}, Variants: []Variant{v("20b", 14), v("120b", 65)}},
		{ID: "qwen2.5-coder", Title: "Qwen2.5 Coder", Publisher: "Alibaba", Pick: "7b",
			Desc: "Для кода, скриптов bash/PowerShell и конфигов. Быстрая и точная.",
			Caps: []string{"tools", "code", "ru"}, Variants: []Variant{v("1.5b", 1.0), v("3b", 1.9), v("7b", 4.7), v("14b", 9.0), v("32b", 20)}},
		{ID: "qwen3-coder", Title: "Qwen3 Coder", Publisher: "Alibaba", Pick: "30b",
			Desc: "Агентная модель для кода: длинный контекст, уверенная работа с инструментами.",
			Caps: []string{"tools", "code"}, Variants: []Variant{v("30b", 19)}},
		{ID: "devstral", Title: "Devstral", Publisher: "Mistral AI", Pick: "24b",
			Desc: "Агент для разработки: правит файлы, запускает команды, разбирает проекты.",
			Caps: []string{"tools", "code"}, Variants: []Variant{v("24b", 14)}},
		{ID: "llama3.1", Title: "Llama 3.1", Publisher: "Meta", Pick: "8b",
			Desc: "Проверенная модель общего назначения с поддержкой инструментов.",
			Caps: []string{"tools"}, Variants: []Variant{v("8b", 4.9), v("70b", 43)}},
		{ID: "llama3.2", Title: "Llama 3.2", Publisher: "Meta", Pick: "3b",
			Desc: "Маленькая и быстрая. Подойдёт для слабых ПК и простых вопросов.",
			Caps: []string{"tools"}, Variants: []Variant{v("1b", 1.3), v("3b", 2.0)}},
		{ID: "mistral-small3.2", Title: "Mistral Small 3.2", Publisher: "Mistral AI", Pick: "24b",
			Desc: "Сильная модель среднего размера: инструменты, картинки, хороший русский.",
			Caps: []string{"tools", "vision", "ru"}, Variants: []Variant{v("24b", 15)}},
		{ID: "mistral-nemo", Title: "Mistral NeMo", Publisher: "Mistral AI", Pick: "12b",
			Desc: "Длинный контекст 128K и инструменты. Хороша для разбора логов.",
			Caps: []string{"tools", "ru"}, Variants: []Variant{v("12b", 7.1)}},
		{ID: "granite3.3", Title: "Granite 3.3", Publisher: "IBM", Pick: "8b",
			Desc: "Компактная модель для инструментов и следования инструкциям.",
			Caps: []string{"tools"}, Variants: []Variant{v("2b", 1.5), v("8b", 4.9)}},
		{ID: "phi4-mini", Title: "Phi-4 mini", Publisher: "Microsoft", Pick: "3.8b",
			Desc: "Маленькая модель с вызовом функций — для ноутбуков без видеокарты.",
			Caps: []string{"tools"}, Variants: []Variant{v("3.8b", 2.5)}},
		{ID: "deepseek-r1", Title: "DeepSeek-R1", Publisher: "DeepSeek", Pick: "8b",
			Desc: "Рассуждающая модель: думает перед ответом. Для сложных вопросов и разборов.",
			Caps: []string{"thinking", "tools"}, Variants: []Variant{v("1.5b", 1.1), v("8b", 5.2), v("14b", 9.0), v("32b", 20)}},
		{ID: "gemma3", Title: "Gemma 3", Publisher: "Google", Pick: "4b",
			Desc: "Понимает картинки и скриншоты, хорошо пишет текст. Инструменты не вызывает — только чат.",
			Caps: []string{"vision", "ru"}, Variants: []Variant{v("1b", 0.8), v("4b", 3.3), v("12b", 8.1), v("27b", 17)}},
		{ID: "qwen2.5vl", Title: "Qwen2.5 VL", Publisher: "Alibaba", Pick: "7b",
			Desc: "Зрение: читает скриншоты ошибок, схемы и документы.",
			Caps: []string{"vision"}, Variants: []Variant{v("3b", 3.2), v("7b", 6.0)}},
		{ID: "nomic-embed-text", Title: "Nomic Embed", Publisher: "Nomic AI", Pick: "latest",
			Desc: "Модель эмбеддингов для поиска по документам (RAG). Не для чата.",
			Caps: []string{"embed"}, Variants: []Variant{v("latest", 0.27)}},
	}
}
