package logging

import (
	"io"
	"os"

	"github.com/rs/zerolog"
)

// Logger wraps a zerolog.Logger to provide structured, correlation-ID-scoped JSON logging.
type Logger struct {
	zl zerolog.Logger
}

// New creates a new Logger configured to emit JSON to os.Stdout (or an injected io.Writer for testing),
// pre-configured with a base field "service": serviceName.
func New(serviceName string, writers ...io.Writer) Logger {
	var out io.Writer = os.Stdout
	if len(writers) > 0 && writers[0] != nil {
		out = writers[0]
	}

	zl := zerolog.New(out).With().
		Str("service", serviceName).
		Logger()

	return Logger{zl: zl}
}

// WithCorrelationID returns a child Logger containing the given correlation ID in its logging context.
func (l Logger) WithCorrelationID(id string) Logger {
	child := l.zl.With().Str("correlationId", id).Logger()
	return Logger{zl: child}
}

// Info logs an informational message with optional structured fields.
func (l Logger) Info(msg string, fields map[string]interface{}) {
	event := l.zl.Info()
	for k, v := range fields {
		event = event.Interface(k, v)
	}
	event.Msg(msg)
}

// Warn logs a warning message with optional structured fields.
func (l Logger) Warn(msg string, fields map[string]interface{}) {
	event := l.zl.Warn()
	for k, v := range fields {
		event = event.Interface(k, v)
	}
	event.Msg(msg)
}

// Error logs an error message, including the error's message as an "error" field,
// along with any optional structured fields.
func (l Logger) Error(msg string, err error, fields map[string]interface{}) {
	event := l.zl.Error()
	if err != nil {
		event = event.Str("error", err.Error())
	}
	for k, v := range fields {
		event = event.Interface(k, v)
	}
	event.Msg(msg)
}
