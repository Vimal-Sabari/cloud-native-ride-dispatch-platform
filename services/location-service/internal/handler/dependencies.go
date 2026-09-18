package handler

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// DynamoWriter captures the narrow DynamoDB interface required by location and status handlers.
type DynamoWriter interface {
	PutItem(ctx context.Context, item map[string]types.AttributeValue) error
	GetItem(ctx context.Context, pk, sk string) (map[string]types.AttributeValue, error)
}
