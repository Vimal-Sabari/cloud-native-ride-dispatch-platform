package dynamoclient

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Client wraps DynamoDB SDK operations for the ride dispatch platform single table.
type Client struct {
	ddb       *dynamodb.Client
	tableName string
}

// NewClient initializes a DynamoDB client.
// If endpoint is empty, it uses the default AWS credential chain and region.
// If endpoint is non-empty (e.g., http://localhost:4566 for LocalStack),
// it configures static dummy credentials ("test", "test") and region "us-east-1".
func NewClient(ctx context.Context, tableName string, endpoint string) (*Client, error) {
	if endpoint != "" {
		region := os.Getenv("AWS_REGION")
		if region == "" {
			region = "us-east-1"
		}
		cfg, err := config.LoadDefaultConfig(ctx,
			config.WithRegion(region),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("test", "test", "")),
		)
		if err != nil {
			return nil, fmt.Errorf("dynamoclient: failed to load local config: %w", err)
		}

		ddbClient := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
			o.BaseEndpoint = aws.String(endpoint)
		})

		return &Client{
			ddb:       ddbClient,
			tableName: tableName,
		}, nil
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("dynamoclient: failed to load aws config: %w", err)
	}

	return &Client{
		ddb:       dynamodb.NewFromConfig(cfg),
		tableName: tableName,
	}, nil
}

// GetItem retrieves an item by its primary key (PK, SK).
// Returns (nil, nil) if the item is not found (non-error).
func (c *Client) GetItem(ctx context.Context, pk, sk string) (map[string]types.AttributeValue, error) {
	out, err := c.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(c.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: sk},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("dynamoclient: get item failed: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, nil
	}
	return out.Item, nil
}

// PutItem writes or replaces an item in the DynamoDB table.
func (c *Client) PutItem(ctx context.Context, item map[string]types.AttributeValue) error {
	_, err := c.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(c.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("dynamoclient: put item failed: %w", err)
	}
	return nil
}

// QueryInput specifies parameters for querying the main table or a secondary index.
type QueryInput struct {
	IndexName                 string
	KeyConditionExpression    string
	ExpressionAttributeValues map[string]types.AttributeValue
	FilterExpression          string // optional
}

// Query executes a query on the main table (if IndexName is empty) or on a named GSI.
func (c *Client) Query(ctx context.Context, input QueryInput) ([]map[string]types.AttributeValue, error) {
	queryInput := &dynamodb.QueryInput{
		TableName:                 aws.String(c.tableName),
		KeyConditionExpression:    aws.String(input.KeyConditionExpression),
		ExpressionAttributeValues: input.ExpressionAttributeValues,
	}
	if input.IndexName != "" {
		queryInput.IndexName = aws.String(input.IndexName)
	}
	if input.FilterExpression != "" {
		queryInput.FilterExpression = aws.String(input.FilterExpression)
	}

	var items []map[string]types.AttributeValue
	paginator := dynamodb.NewQueryPaginator(c.ddb, queryInput)
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("dynamoclient: query page failed: %w", err)
		}
		items = append(items, page.Items...)
	}

	return items, nil
}

// ConditionalPutItem attempts to put an item subject to a ConditionExpression.
// If the condition check fails (ConditionalCheckFailedException), it returns (false, nil).
// On genuine errors (network, validation, throttling), it returns (false, err).
// On successful put, it returns (true, nil).
func (c *Client) ConditionalPutItem(ctx context.Context, item map[string]types.AttributeValue, conditionExpression string) (bool, error) {
	putInput := &dynamodb.PutItemInput{
		TableName:           aws.String(c.tableName),
		Item:                item,
		ConditionExpression: aws.String(conditionExpression),
	}

	var names map[string]string
	var values map[string]types.AttributeValue

	if strings.Contains(conditionExpression, "#status") {
		names = map[string]string{"#status": "Status"}
	}
	if strings.Contains(conditionExpression, ":available") {
		if values == nil {
			values = make(map[string]types.AttributeValue)
		}
		values[":available"] = &types.AttributeValueMemberS{Value: "available"}
	}
	if strings.Contains(conditionExpression, ":busy") {
		if values == nil {
			values = make(map[string]types.AttributeValue)
		}
		values[":busy"] = &types.AttributeValueMemberS{Value: "busy"}
	}

	if len(names) > 0 {
		putInput.ExpressionAttributeNames = names
	}
	if len(values) > 0 {
		putInput.ExpressionAttributeValues = values
	}

	_, err := c.ddb.PutItem(ctx, putInput)
	if err != nil {
		var condErr *types.ConditionalCheckFailedException
		if errors.As(err, &condErr) {
			return false, nil
		}
		return false, fmt.Errorf("dynamoclient: conditional put item failed: %w", err)
	}

	return true, nil
}
