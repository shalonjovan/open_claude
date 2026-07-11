export interface ConnectorTextBlock {
	type: "connector_text";
	connector_text: string;
}

export function isConnectorTextBlock(block: any): block is ConnectorTextBlock {
	return (
		block !== null &&
		typeof block === "object" &&
		(block.type === "connector_text" || typeof block.connector_text === "string")
	);
}
