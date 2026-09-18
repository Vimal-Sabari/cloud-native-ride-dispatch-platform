package handler_test

import (
	"context"
	"sync"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// fakeDynamo is an in-memory, thread-safe fake implementation of DynamoWriter
// for isolated unit testing with zero external AWS/network dependencies.
type fakeDynamo struct {
	mu           sync.Mutex
	items        map[string]map[string]types.AttributeValue
	putCalls     []map[string]types.AttributeValue
	getItemCalls [][2]string
	getItemErr   error
	putItemErr   error
}

func newFakeDynamo() *fakeDynamo {
	return &fakeDynamo{
		items: make(map[string]map[string]types.AttributeValue),
	}
}

func (f *fakeDynamo) key(pk, sk string) string {
	return pk + "##" + sk
}

func (f *fakeDynamo) setItem(pk, sk string, item map[string]types.AttributeValue) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.items[f.key(pk, sk)] = item
}

func (f *fakeDynamo) PutItem(ctx context.Context, item map[string]types.AttributeValue) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.putItemErr != nil {
		return f.putItemErr
	}
	f.putCalls = append(f.putCalls, item)
	var pk, sk string
	if v, ok := item["PK"].(*types.AttributeValueMemberS); ok {
		pk = v.Value
	}
	if v, ok := item["SK"].(*types.AttributeValueMemberS); ok {
		sk = v.Value
	}
	f.items[f.key(pk, sk)] = item
	return nil
}

func (f *fakeDynamo) GetItem(ctx context.Context, pk, sk string) (map[string]types.AttributeValue, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.getItemCalls = append(f.getItemCalls, [2]string{pk, sk})
	if f.getItemErr != nil {
		return nil, f.getItemErr
	}
	item, ok := f.items[f.key(pk, sk)]
	if !ok {
		return nil, nil
	}
	return item, nil
}
