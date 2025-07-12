export interface SearchToken {
    type: 'tag' | 'collection' | 'text';
    value: string;
    exclude: boolean;
    group?: number;
}

// AST Node types
export interface ASTNode {
    type: 'operator' | 'filter' | 'text';
}

export interface OperatorNode extends ASTNode {
    type: 'operator';
    operator: 'AND' | 'OR';
    left: ASTNode;
    right: ASTNode;
}

export interface FilterNode extends ASTNode {
    type: 'filter';
    filterType: 'tag' | 'collection';
    value: string;
    exclude: boolean;
}

export interface TextNode extends ASTNode {
    type: 'text';
    value: string;
}

export interface ParsedSearch {
    ast: ASTNode | null;
}

interface Token {
    type: 'FILTER' | 'TEXT' | 'AND' | 'OR' | 'LPAREN' | 'RPAREN';
    value: string;
    filterType?: 'tag' | 'collection';
    exclude?: boolean;
}

export class SearchParser {
    private static tokens: Token[] = [];
    private static position: number = 0;
    private static depth: number = 0;
    private static readonly MAX_DEPTH = 50;

    static parseQuery(query: string): ParsedSearch {
        if (!query.trim()) {
            return { ast: null };
        }

        try {
            // Tokenize the input
            this.tokens = this.tokenize(query);
            this.position = 0;
            this.depth = 0;

            // Parse into AST with depth limit to prevent infinite recursion
            const ast = this.parseExpression();
            
            return { ast };
        } catch (error) {
            console.warn('Search parsing error:', error);
            // Return null AST on parse error to gracefully fall back
            return { ast: null };
        }
    }

    private static tokenize(query: string): Token[] {
        const tokens: Token[] = [];
        let i = 0;
        let iterations = 0;
        const maxIterations = query.length * 2; // Safety limit
        
        while (i < query.length && iterations < maxIterations) {
            iterations++;
            // Skip whitespace
            if (/\s/.test(query[i])) {
                i++;
                continue;
            }

            // Handle parentheses
            if (query[i] === '(') {
                tokens.push({ type: 'LPAREN', value: '(' });
                i++;
                continue;
            }
            if (query[i] === ')') {
                tokens.push({ type: 'RPAREN', value: ')' });
                i++;
                continue;
            }

            // Handle operators (AND, OR) - case sensitive only
            if (query.substr(i, 3) === 'AND' && (i + 3 >= query.length || /\s/.test(query[i + 3]))) {
                tokens.push({ type: 'AND', value: 'AND' });
                i += 3;
                continue;
            }
            if (query.substr(i, 2) === 'OR' && (i + 2 >= query.length || /\s/.test(query[i + 2]))) {
                tokens.push({ type: 'OR', value: 'OR' });
                i += 2;
                continue;
            }

            // Handle filters and text
            const match = query.substr(i).match(/^(-?)([#@])([a-zA-Z0-9_-]+)/);
            if (match) {
                const exclude = match[1] === '-';
                const symbol = match[2];
                const value = match[3];
                tokens.push({
                    type: 'FILTER',
                    value: value,
                    filterType: symbol === '#' ? 'tag' : 'collection',
                    exclude
                });
                i += match[0].length;
                continue;
            }

            // Handle regular text
            let textStart = i;
            while (i < query.length && 
                   !/\s/.test(query[i]) && 
                   query[i] !== '(' && 
                   query[i] !== ')' && 
                   !query.substr(i).match(/^(-?)([#@])([a-zA-Z0-9_-]+)/) &&
                   !query.substr(i, 3).startsWith('AND') &&
                   !query.substr(i, 2).startsWith('OR')) {
                i++;
            }
            
            if (i > textStart) {
                const textValue = query.substring(textStart, i);
                tokens.push({ type: 'TEXT', value: textValue });
            } else {
                // Safety: if no progress was made, advance by one character to prevent infinite loop
                i++;
            }
        }

        return tokens;
    }

    // Recursive descent parser with precedence
    // OR has lower precedence than AND
    private static parseExpression(): ASTNode | null {
        if (++this.depth > this.MAX_DEPTH) {
            throw new Error('Maximum parsing depth exceeded');
        }
        
        let left = this.parseAndExpression();
        let iterations = 0;
        
        while (this.current()?.type === 'OR' && iterations < 100) {
            this.advance(); // consume OR
            const right = this.parseAndExpression();
            if (!right) break;
            
            left = {
                type: 'operator',
                operator: 'OR',
                left: left!,
                right
            } as OperatorNode;
            iterations++;
        }
        
        this.depth--;
        return left;
    }

    private static parseAndExpression(): ASTNode | null {
        if (++this.depth > this.MAX_DEPTH) {
            throw new Error('Maximum parsing depth exceeded');
        }
        
        let left = this.parsePrimary();
        let iterations = 0;
        
        while ((this.current()?.type === 'AND' || this.isImplicitAnd()) && iterations < 100) {
            if (this.current()?.type === 'AND') {
                this.advance(); // consume AND
            }
            const right = this.parsePrimary();
            if (!right) break;
            
            left = {
                type: 'operator',
                operator: 'AND',
                left: left!,
                right
            } as OperatorNode;
            iterations++;
        }
        
        this.depth--;
        return left;
    }

    private static parsePrimary(): ASTNode | null {
        if (++this.depth > this.MAX_DEPTH) {
            throw new Error('Maximum parsing depth exceeded');
        }
        
        const token = this.current();
        if (!token) {
            this.depth--;
            return null;
        }

        if (token.type === 'LPAREN') {
            this.advance(); // consume (
            const expr = this.parseExpression();
            if (this.current()?.type === 'RPAREN') {
                this.advance(); // consume )
            }
            this.depth--;
            return expr;
        }

        if (token.type === 'FILTER') {
            this.advance();
            const result = {
                type: 'filter',
                filterType: token.filterType!,
                value: token.value,
                exclude: token.exclude || false
            } as FilterNode;
            this.depth--;
            return result;
        }

        if (token.type === 'TEXT') {
            this.advance();
            const result = {
                type: 'text',
                value: token.value
            } as TextNode;
            this.depth--;
            return result;
        }

        this.depth--;
        return null;
    }

    private static current(): Token | undefined {
        return this.tokens[this.position];
    }

    private static advance(): void {
        this.position++;
    }

    private static isImplicitAnd(): boolean {
        const token = this.current();
        return token && (token.type === 'FILTER' || token.type === 'TEXT' || token.type === 'LPAREN');
    }

    static getTokensFromQuery(query: string): SearchToken[] {
        const tokens: SearchToken[] = [];
        const parsed = this.parseQuery(query);
        
        if (parsed.ast) {
            this.extractTokensFromAST(parsed.ast, tokens);
        }

        return tokens;
    }

    private static extractTokensFromAST(node: ASTNode, tokens: SearchToken[]): void {
        if (node.type === 'filter') {
            const filterNode = node as FilterNode;
            tokens.push({
                type: filterNode.filterType,
                value: filterNode.value,
                exclude: filterNode.exclude
            });
        } else if (node.type === 'text') {
            const textNode = node as TextNode;
            tokens.push({
                type: 'text',
                value: textNode.value,
                exclude: false
            });
        } else if (node.type === 'operator') {
            const opNode = node as OperatorNode;
            this.extractTokensFromAST(opNode.left, tokens);
            this.extractTokensFromAST(opNode.right, tokens);
        }
    }
}